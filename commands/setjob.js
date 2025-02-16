const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const { google } = require('googleapis');
const path = require('path');
require('dotenv').config();

const config = require(path.join(__dirname, '../config/config.json'));
const serviceAccount = require(path.join(__dirname, '../config/google-service-account.json'));

const COLUMNS = {
    DISCORD_ID: 0,
    NAME: 1,
    RECRUIT_DATE: 2,
    ACCOUNT: 3,
    PHONE: 4,
    ROLE_NAME: 5,
    RECRUITER_ID: 6,
    CHANNEL_ID: 9,
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setjob')
        .setDescription("Ajouter un employé à l'entreprise.")
        .addUserOption(option =>
            option.setName('discord')
                .setDescription('La personne concernée par ce job')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('nom')
                .setDescription('Le nom et prénom de la personne')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('telephone')
                .setDescription('Le numéro de téléphone')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('banque')
                .setDescription('Le numéro de compte bancaire')
                .setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply();

        const person = interaction.options.getUser('discord');
        const member = await interaction.guild.members.fetch(person.id);
        const name = interaction.options.getString('nom');
        const phone = interaction.options.getString('telephone') || 'Non fourni';
        const account = interaction.options.getString('banque') || 'Non fourni';
        const recruiterId = interaction.user.id;
        const recruitDate = new Date().toLocaleString('fr-FR');

        const { categoryEmployeId, CDDRoleID, chefEquipeRoleId, googleSheetId } = config;

        if (!interaction.member.roles.cache.has(chefEquipeRoleId)) {
            return interaction.editReply({ content: "❌ Vous n'avez pas la permission d'utiliser cette commande." });
        }

        try {
            const auth = new google.auth.GoogleAuth({
                credentials: serviceAccount,
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });
            const sheets = google.sheets({ version: 'v4', auth });

            const getSheetData = async (range) => {
                const response = await sheets.spreadsheets.values.get({
                    spreadsheetId: googleSheetId,
                    range,
                });
                return response.data.values || [];
            };

            const employeelistRows = await getSheetData('employeelist!B:B');
            const alreadyExists = employeelistRows.some(row => row[COLUMNS.DISCORD_ID] === person.id);

            if (alreadyExists) {
                return interaction.editReply({ content: `🚫 ${member.displayName} est déjà employé !` });
            }

            await sheets.spreadsheets.values.append({
                spreadsheetId: googleSheetId,
                range: 'RegistrePersonnel',
                valueInputOption: 'RAW',
                resource: {
                    values: [[person.id, name, recruitDate, account, phone, recruiterId, "Embauche"]]
                },
            });

            const role = interaction.guild.roles.cache.get(CDDRoleID);
            if (!role) {
                return interaction.editReply({ content: "Le rôle spécifié dans la configuration est introuvable." });
            }

            const memberR = await interaction.guild.members.fetch(person.id);
            if (!memberR.roles.cache.has(CDDRoleID)) {
                await memberR.roles.add(role);
            }

            const category = await interaction.guild.channels.fetch(categoryEmployeId);
            if (!category) {
                return interaction.editReply({ content: "La catégorie spécifiée est introuvable." });
            }

            const channelName = name.toLowerCase().replace(/\s+/g, '-');
            const newChannel = await interaction.guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: category,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: person.id, allow: [PermissionsBitField.Flags.ViewChannel] },
                    { id: chefEquipeRoleId, allow: [PermissionsBitField.Flags.ViewChannel] },
                ],
            });

            const createEmbed = (embedConfig) => {
                const embed = new EmbedBuilder()
                    .setTitle(embedConfig.title)
                    .setDescription(embedConfig.description.replace("{name}", name).replace("{phone}", phone).replace("{account}", account))
                    .setColor(embedConfig.color);
                if (embedConfig.imageUrl) {
                    embed.setThumbnail(embedConfig.imageUrl);
                }
                return embed;
            };

            const embed1 = createEmbed(config.embedMessage1);
            const embed2 = createEmbed(config.embedMessage2);

            const firstMessage = await newChannel.send({ embeds: [embed1] });
            firstMessage.pin();
            await newChannel.send({ embeds: [embed2] });

            await interaction.editReply({ content: `Le salon ${newChannel.name} a été créé avec succès pour ${member.displayName}.` });

            await sheets.spreadsheets.values.append({
                spreadsheetId: googleSheetId,
                range: 'employeelist',
                valueInputOption: 'RAW',
                resource: {
                    values: [[person.id, name, recruitDate, account, phone, role.name, recruiterId, "...", "...", newChannel.id]]
                },
            });

            console.log("EMPLOYE - Nouvelle ligne ajoutée avec succès.");

        } catch (error) {
            console.error("Erreur Google Sheets:", error);
            return interaction.editReply({ content: "❌ Une erreur est survenue lors de l'ajout de l'employé." });
        }
    },
};
