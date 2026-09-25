const { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder, MessageFlags } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const { config } = require('../config');

const LOG_DIR = path.join(__dirname, '..', '..', 'data');

// Секреты из .env никогда не должны утечь в Discord — маскируем их значения
function secrets() {
  const vals = new Set([
    config.token,
    config.siteAuth?.clientSecret,
    config.siteAuth?.sessionSecret,
    config.music?.spotifyClientSecret,
    config.reposter?.instagramSessionId,
    config.reposter?.instagramCsrf,
    config.webhook?.secret,
    process.env.SITE_API_KEY,
  ]);
  return [...vals].filter(v => typeof v === 'string' && v.length >= 8);
}

function redact(text) {
  let out = String(text || '');
  for (const s of secrets()) out = out.split(s).join('***');
  return out;
}

function tail(file, n) {
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  // убираем пустые хвосты
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.slice(-n).join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logs')
    .setDescription('Показать хвост логов бота (только модерация)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(o => o.setName('lines').setDescription('Сколько строк (5–50, по умолч. 20)').setMinValue(5).setMaxValue(50))
    .addStringOption(o => o.setName('source').setDescription('Какой лог')
      .addChoices({ name: 'bot (stdout)', value: 'bot' }, { name: 'errors (stderr)', value: 'err' })),
  async execute(interaction) {
    const isAdmin = config.adminIds.includes(interaction.user.id);
    const isMod = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
    if (!isAdmin && !isMod) {
      await interaction.reply({ content: '❌ Только для модерации.', flags: MessageFlags.Ephemeral });
      return;
    }
    const n = interaction.options.getInteger('lines') || 20;
    const src = interaction.options.getString('source') || 'bot';
    const file = path.join(LOG_DIR, src === 'err' ? 'bot.err.log' : 'bot.log');
    const text = tail(file, n);
    if (text == null) {
      await interaction.reply({ content: '❌ Лог-файл не найден (бот запущен не в фоне?).', flags: MessageFlags.Ephemeral });
      return;
    }
    const clean = redact(text) || '_лог пуст_';
    if (clean.length < 1800) {
      await interaction.reply({ content: `\`\`\`\n${clean}\n\`\`\``, flags: MessageFlags.Ephemeral });
    } else {
      const buf = Buffer.from(clean, 'utf8');
      await interaction.reply({
        content: `Лог длинный — отправляю файлом (последние ${n} строк, секреты замаскированы):`,
        files: [new AttachmentBuilder(buf, { name: `${src}.log.txt` })],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
