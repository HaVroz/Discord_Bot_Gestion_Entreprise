const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { google } = require('googleapis');
const path = require('path');
require('dotenv').config();

const config = require(path.join(__dirname, '../config/config.json'));
const serviceAccount = require(path.join(__dirname, '../config/google-service-account.json'));

const COLUMNS = {
    DISCORD_ID: 1,
    CHANNEL_ID: 10,
    DATE: 2,
    EXECUTOR_ID: 5,
    STATUS: 6,
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('licencier')
        .setDescription("Licencie un employé de l'entreprise.")
        .addUserOption(option =>
            option.setName('discord')
                .setDescription("La personne à licencier")
                .setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply();

        const person = interaction.options.getUser('discord');
        const member = await interaction.guild.members.fetch(person.id);
        const guild = interaction.guild;
        const { googleSheetId, defaultRoleId, EMPLOYEELIST_SHEET_ID, PAYE_SHEET_ID, PAYE_2_SHEET_ID, chefEquipeRoleId } = config;
        const currentDate = new Date().toLocaleString('fr-FR');
        const executorId = interaction.user.id;

        if (!interaction.member.roles.cache.has(chefEquipeRoleId)) {
            return interaction.followUp({ content: "❌ Vous n'avez pas la permission d'utiliser cette commande." });
        }

        if (!defaultRoleId) {
            return interaction.followUp({ content: "L'ID du rôle par défaut est introuvable dans la configuration." });
        }

        try {
            const auth = new google.auth.GoogleAuth({
                credentials: serviceAccount,
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });

            const authClient = await auth.getClient();
            google.options({ auth: authClient });

            const sheets = google.sheets({ version: 'v4' });

            const getSheetData = async (range) => {
                const response = await sheets.spreadsheets.values.get({
                    spreadsheetId: googleSheetId,
                    range,
                });
                return response.data.values;
            };

            const deleteRow = async (sheetId, rowIndex) => {
                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId: googleSheetId,
                    requestBody: {
                        requests: [{
                            deleteDimension: {
                                range: {
                                    sheetId,
                                    dimension: "ROWS",
                                    startIndex: rowIndex - 1,
                                    endIndex: rowIndex
                                }
                            }
                        }]
                    }
                });
            };

            const rowsEL = await getSheetData('employeelist');
            if (!rowsEL || rowsEL.length === 0) {
                return interaction.followUp({ content: "❌ La liste des employés est vide, impossible de vérifier." });
            }

            const isStillEmployed = rowsEL.some(row => row[COLUMNS.DISCORD_ID] === person.id);
            if (!isStillEmployed) {
                return interaction.followUp({ content: `⚠️ ${member.displayName} est déjà licencié ou n'existe pas dans la liste des employés.` });
            }

            const updatePayeSheet = async (range, sheetId) => {
                const rows = await getSheetData(range);
                const rowIndex = rows.findIndex(row => row[COLUMNS.DISCORD_ID] === person.id);
                if (rowIndex !== -1) {
                    await deleteRow(sheetId, rowIndex + 1);
                }
            };

            await updatePayeSheet('Paye', PAYE_SHEET_ID);
            await updatePayeSheet('Paye_2', PAYE_2_SHEET_ID);

            const employeeRowIndex = rowsEL.findIndex(row => row[COLUMNS.DISCORD_ID] === person.id);
            if (employeeRowIndex !== -1) {
                await deleteRow(EMPLOYEELIST_SHEET_ID, employeeRowIndex + 1);
            }

            const rowsRP = await getSheetData('RegistrePersonnel');
            if (!rowsRP || rowsRP.length === 0) {
                return interaction.followUp({ content: "Aucune donnée trouvée dans RegistrePersonnel." });
            }

            const registerRowIndex = rowsRP.findIndex(row => row[0] === person.id);
            if (registerRowIndex !== -1) {
                const employeeRow = rowsRP[registerRowIndex];
                const newRow = [...employeeRow];
                newRow[COLUMNS.DATE] = currentDate;
                newRow[COLUMNS.EXECUTOR_ID] = executorId;
                newRow[COLUMNS.STATUS] = "Démissionné/Licencié";

                await sheets.spreadsheets.values.append({
                    spreadsheetId: googleSheetId,
                    range: 'RegistrePersonnel',
                    valueInputOption: 'RAW',
                    resource: { values: [newRow] }
                });
            }

            const memberR = await guild.members.fetch(person.id).catch(() => null);
            if (memberR) {
                await memberR.roles.set([defaultRoleId]).catch(console.error);
            }

            await interaction.followUp({ content: `🚨 ${member.displayName} a été licencié, les données ont été mises à jour et son salon a été supprimé.` });

            const channelIdToDelete = rowsEL[employeeRowIndex][COLUMNS.CHANNEL_ID];
            if (channelIdToDelete) {
                const channel = await guild.channels.fetch(channelIdToDelete).catch(() => null);
                if (channel) {
                    await channel.delete().catch(console.error);
                }
            }

        } catch (error) {
            console.error("Erreur lors du licenciement :", error);
            await interaction.followUp({ content: "❌ Une erreur est survenue lors du licenciement." }).catch(() => {});
        }
    },
};
