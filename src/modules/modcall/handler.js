// ModCall: button -> modal -> ticket in staff channel + two-way relay via bot DM.
// Own implementation for HPSB (not a Carl copy).
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

// sessions in memory + persist mapping staffMessageId -> { userId, threadId, open }
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
  // Open modal
  if (interaction.isButton() && interaction.customId === BTN_OPEN) {
    if (sessions.has(interaction.user.id)) {
      await interaction.reply({ content: '📩 You already have an open ticket. Wait for a reply in DM.', flags: MessageFlags.Ephemeral });
      return true;
    }
    const modal = new ModalBuilder().setCustomId(MODAL_ID).setTitle('Contact Moderation');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('subject').setLabel('Subject').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('body').setLabel('Describe the issue').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1500),
      ),
    );
    await interaction.showModal(modal);
    return true;
  }

  // Modal submit -> post to staff
  if (interaction.isModalSubmit() && interaction.customId === MODAL_ID) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const subject = interaction.fields.getTextInputValue('subject');
      const body = interaction.fields.getTextInputValue('body');
    const staff = await staffChannel(client);
    if (!staff?.isTextBased()) {
      await interaction.editReply('❌ Staff channel not configured (MODCALL_STAFF_CHANNEL_ID).');
      return true;
    }
    const embed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle(`📞 ModCall: ${subject}`)
      .setDescription(body.slice(0, 2000))
      .addFields({ name: 'Author', value: `${interaction.user} (${interaction.user.id})` })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${BTN_TAKE}:${interaction.user.id}`).setLabel('Take / create thread').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${BTN_CLOSE}:${interaction.user.id}`).setLabel('Close').setStyle(ButtonStyle.Danger),
    );

    const msg = await staff.send({
      content: config.modRoleId ? `<@&${config.modRoleId}> new request` : 'New request',
      embeds: [embed],
      components: [row],
    });

    sessions.set(interaction.user.id, { staffMessageId: msg.id, threadId: null });
    persistSessions();

    try { await interaction.user.send(`✅ Your request **${subject}** forwarded to moderation. Reply right here in DM -- I'll relay to mods.`); } catch {}
    await interaction.editReply('✅ Sent! Moderation will reply to you in DM.');
    } catch (e) {
      logger.warn('[modcall] submit failed', e.message);
      await interaction.editReply('❌ Could not create ticket (no access to staff channel?).').catch(() => {});
    }
    return true;
  }

  // Staff buttons: take / close. customId like "modcall:take:<userId>" -- we take LAST part.
  if (interaction.isButton() && (interaction.customId.startsWith(BTN_TAKE) || interaction.customId.startsWith(BTN_CLOSE))) {
    const userId = interaction.customId.split(':').pop();
    const { hasModRole } = require('../../utils/mod');
    const isAdmin = config.adminIds.includes(interaction.user.id);
    const isMod = isAdmin || hasModRole(interaction.member)
      || interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages);
    if (!isMod) {
      await interaction.reply({ content: '❌ Moderation only.', flags: MessageFlags.Ephemeral });
      return true;
    }
    const sess = sessions.get(userId);
    if (!sess) { await interaction.reply({ content: 'Ticket already closed.', flags: MessageFlags.Ephemeral }); return true; }

    if (interaction.customId.startsWith(BTN_CLOSE)) {
      const sessSnap = sess.threadId;
      sessions.delete(userId);
      persistSessions();
      // close thread properly: archive + lock
      if (sessSnap) {
        try {
          const thread = await client.channels.fetch(sessSnap).catch(() => null);
          if (thread?.isThread?.()) {
            await thread.send('🔒 Ticket closed by moderation.').catch(() => {});
            await thread.setLocked(true).catch(() => {});
            await thread.setArchived(true).catch(() => {});
          }
        } catch {}
      }
      await interaction.reply(`🔒 Ticket ${userId} closed.`);
      try {
        const u = await client.users.fetch(userId);
        await u.send('🔒 Your request closed by moderation. If you need more -- press the button again.');
      } catch {}
      return true;
    }

    // take -> thread under staff message (reuse existing)
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
      await thread.send(`🧵 Thread for ticket <@${userId}>. Write here -- bot will relay to user in DM.`);
      await interaction.reply({ content: `✅ Thread created: ${thread}`, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: '❌ Could not create thread.', flags: MessageFlags.Ephemeral });
    }
    return true;
  }

  return false;
}

// Mod writes in thread -> user in DM (text + attachments)
async function relayStaffMessage(message, client) {
  if (!message.guild || message.author.bot) return false;
  for (const [userId, sess] of sessions) {
    if (sess.threadId && message.channelId === sess.threadId) {
      try {
        const u = await client.users.fetch(userId);
        const files = [...(message.attachments?.values() || [])].map(a => a.url).slice(0, 5);
        const text = `👮 **HPSB Moderation:** ${(message.content || '').slice(0, 1500)}${files.length ? '\n' + files.join('\n') : ''}`;
        if (!message.content && !files.length) return true; // sticker/empty -- nothing to send
        await u.send(text.slice(0, 1900));
        return true;
      } catch (e) { logger.warn('[modcall] dm failed', e.message); return true; }
    }
  }
  return false;
}

// User writes to bot in DM -> staff thread (text + attachments)
async function relayUserDm(message, client) {
  const sess = sessions.get(message.author.id);
  if (!sess) return; // no open ticket -- ignore
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
