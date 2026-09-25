// ModCall: кнопка -> модалка -> тикет в staff-канале + двусторонний релей через ЛС бота.
// Своя реализация под HPSB (не копия Carl).
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { config } = require('../../config');
const { logger } = require('../../utils/logger');
const store = require('../../utils/store');

const BTN_OPEN = 'modcall:open';
const BTN_TAKE = 'modcall:take';
const BTN_CLOSE = 'modcall:close';
const MODAL_ID = 'modcall:modal';

// sessions в памяти + персист маппинга staffMessageId -> { userId, threadId, open }
let sessions = new Map(); // userId -> { staffMessageId, threadId }

function loadSessions() {
  const data = store.load();
  sessions = new Map(Object.entries(data.modcall || {}));
}
function persistSessions() {
  const data = store.load();
  data.modcall = Object.fromEntries(sessions);
  store.save(data);
}
loadSessions();

async function staffChannel(client) {
  const id = config.modcall.staffChannelId;
  if (!id) return null;
  return client.channels.fetch(id).catch(() => null);
}

async function handleInteraction(interaction, client) {
  // Открыть модалку
  if (interaction.isButton() && interaction.customId === BTN_OPEN) {
    if (sessions.has(interaction.user.id)) {
      await interaction.reply({ content: '📩 У тебя уже есть открытый тикет. Дождись ответа в ЛС.', flags: MessageFlags.Ephemeral });
      return true;
    }
    const modal = new ModalBuilder().setCustomId(MODAL_ID).setTitle('Связь с модерацией');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('subject').setLabel('Тема').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('body').setLabel('Опиши проблему').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1500),
      ),
    );
    await interaction.showModal(modal);
    return true;
  }

  // Сабмит модалки -> пост в staff
  if (interaction.isModalSubmit() && interaction.customId === MODAL_ID) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const subject = interaction.fields.getTextInputValue('subject');
      const body = interaction.fields.getTextInputValue('body');
    const staff = await staffChannel(client);
    if (!staff?.isTextBased()) {
      await interaction.editReply('❌ Staff-канал не настроен (MODCALL_STAFF_CHANNEL_ID).');
      return true;
    }
    const embed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle(`📞 ModCall: ${subject}`)
      .setDescription(body.slice(0, 2000))
      .addFields({ name: 'Автор', value: `${interaction.user} (${interaction.user.id})` })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${BTN_TAKE}:${interaction.user.id}`).setLabel('Взять / создать тред').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${BTN_CLOSE}:${interaction.user.id}`).setLabel('Закрыть').setStyle(ButtonStyle.Danger),
    );

    const msg = await staff.send({
      content: config.modRoleId ? `<@&${config.modRoleId}> новый запрос` : 'Новый запрос',
      embeds: [embed],
      components: [row],
    });

    sessions.set(interaction.user.id, { staffMessageId: msg.id, threadId: null });
    persistSessions();

    try { await interaction.user.send(`✅ Твой запрос **${subject}** передан модерации. Отвечай прямо сюда в ЛС — я перешлю модам.`); } catch {}
    await interaction.editReply('✅ Отправлено! Модерация ответит тебе в ЛС.');
    } catch (e) {
      logger.warn('[modcall] submit failed', e.message);
      await interaction.editReply('❌ Не смог создать тикет (нет доступа к staff-каналу?).').catch(() => {});
    }
    return true;
  }

  // Кнопки staff: взять / закрыть. customId вида "modcall:take:<userId>" — берём ПОСЛЕДНИЙ кусок.
  if (interaction.isButton() && (interaction.customId.startsWith(BTN_TAKE) || interaction.customId.startsWith(BTN_CLOSE))) {
    const userId = interaction.customId.split(':').pop();
    const isAdmin = config.adminIds.includes(interaction.user.id);
    if (!isAdmin && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({ content: '❌ Только для модерации.', flags: MessageFlags.Ephemeral });
      return true;
    }
    const sess = sessions.get(userId);
    if (!sess) { await interaction.reply({ content: 'Тикет уже закрыт.', flags: MessageFlags.Ephemeral }); return true; }

    if (interaction.customId.startsWith(BTN_CLOSE)) {
      const sessSnap = sess.threadId;
      sessions.delete(userId);
      persistSessions();
      // закрываем ветку по-нормальному: архив + замок
      if (sessSnap) {
        try {
          const thread = await client.channels.fetch(sessSnap).catch(() => null);
          if (thread?.isThread?.()) {
            await thread.send('🔒 Тикет закрыт модерацией.').catch(() => {});
            await thread.setLocked(true).catch(() => {});
            await thread.setArchived(true).catch(() => {});
          }
        } catch {}
      }
      await interaction.reply(`🔒 Тикет ${userId} закрыт.`);
      try {
        const u = await client.users.fetch(userId);
        await u.send('🔒 Твой запрос закрыт модерацией. Если нужно ещё — нажми кнопку снова.');
      } catch {}
      return true;
    }

    // take -> тред под staff-сообщением (переиспользуем существующий)
    let thread = sess.threadId ? await client.channels.fetch(sess.threadId).catch(() => null) : null;
    if (!thread?.isThread?.()) {
      thread = await interaction.message.startThread({ name: `modcall-${userId.slice(-4)}`, autoArchiveDuration: 1440 }).catch(() => null);
    } else if (thread.archived) {
      await thread.setArchived(false).catch(() => {});
    }
    if (thread) {
      sess.threadId = thread.id;
      sessions.set(userId, sess);
      persistSessions();
      await thread.send(`🧵 Тред по тикету <@${userId}>. Пиши сюда — бот перешлёт юзеру в ЛС.`);
      await interaction.reply({ content: `✅ Тред создан: ${thread}`, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: '❌ Не смог создать тред.', flags: MessageFlags.Ephemeral });
    }
    return true;
  }

  return false;
}

// Мод пишет в тред -> юзеру в ЛС (текст + вложения)
async function relayStaffMessage(message, client) {
  if (!message.guild || message.author.bot) return false;
  for (const [userId, sess] of sessions) {
    if (sess.threadId && message.channelId === sess.threadId) {
      try {
        const u = await client.users.fetch(userId);
        const files = [...(message.attachments?.values() || [])].map(a => a.url).slice(0, 5);
        const text = `👮 **Модерация HPSB:** ${(message.content || '').slice(0, 1500)}${files.length ? '\n' + files.join('\n') : ''}`;
        if (!message.content && !files.length) return true; // стикер/пустое — нечего слать
        await u.send(text.slice(0, 1900));
        return true;
      } catch (e) { logger.warn('[modcall] dm failed', e.message); return true; }
    }
  }
  return false;
}

// Юзер пишет боту в ЛС -> в тред staff (текст + вложения)
async function relayUserDm(message, client) {
  const sess = sessions.get(message.author.id);
  if (!sess) return; // нет открытого тикета — игнор
  const staff = await staffChannel(client);
  if (!staff) return;
  const files = [...(message.attachments?.values() || [])].map(a => a.url).slice(0, 5);
  if (!message.content && !files.length) return;
  const text = `💬 <@${message.author.id}>: ${(message.content || '').slice(0, 1500)}${files.length ? '\n' + files.join('\n') : ''}`;
  try {
    if (sess.threadId) {
      const thread = await client.channels.fetch(sess.threadId).catch(() => null);
      if (thread?.isTextBased()) { await thread.send(text); return; }
    }
    const staffMsg = await staff.messages.fetch(sess.staffMessageId).catch(() => null);
    if (staffMsg) {
      await staffMsg.reply(text).catch(() => staff.send(text));
    } else {
      await staff.send(text);
    }
  } catch (e) { logger.warn('[modcall] relay failed', e.message); }
}

module.exports = { handleInteraction, relayStaffMessage, relayUserDm };
