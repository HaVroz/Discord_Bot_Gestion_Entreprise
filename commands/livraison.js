const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const path = require('path');
require('dotenv').config();

const config = require(path.join(__dirname, '../config/config.json'));

module.exports = {
    data: new SlashCommandBuilder()
        .setName('livraison')
        .setDescription("Annonce une livraison en cours"),
    async execute(interaction) {

        const { chefEquipeRoleId } = config;
        
        if (!interaction.member.roles.cache.has(chefEquipeRoleId)) {
            return interaction.reply({ content: "❌ Vous n'avez pas la permission d'utiliser cette commande."});
        }
		
		// Nom de l'utilisateur en gras
        const displayName = interaction.member.displayName;
		
        await interaction.reply(`🚚 **${displayName}** s'occupe de la livraison !`);
    }
};
