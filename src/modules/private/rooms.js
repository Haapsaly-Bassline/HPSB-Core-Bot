// Приватные войсы как VoiceMaster: зашёл в генератор -> своя комната + панель.
// Панель: замок, rename, лимит, передача, кик. Пустая комната удаляется,
// владелец вышел — комната переходит первому оставшемуся.
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder, ChannelType, PermissionFlagsBits, MessageFlags,
  UserSelectMenuBuilder,
} = require('discord.js');
const { config } = require('../../config');
const { logger } = require('../../utils/logger');
const store = require('../../utils/store');

const BTN_LOCK = 'priv:lock';
const BTN_RENAME = 'priv:rename';
const BTN_LIMIT = 'priv:limit';
const BTN_GIVE = 'priv:give';
const BTN_KICK = 'priv:kick';
const MODAL_RENAME = 'priv:modal:rename';
const MODAL_LIMIT = 'priv:modal:limit';

function state() {
  const d = store.load();
  d.privates = d.privates || {};
  return d;
}
function save(d) { store.save(d); }

function roomName(user) {
  const tpl = config.priv.nameTemplate || `{user}'s room`;
  return tpl.split('{user}').join(user.username).slice(0, 90) || `${user.username}'s room`;
}

function panelEmbed(owner) {
  return new EmbedBuilder().setColor(0x7c3aed).setTitle('🔊 Твоя приватка').setTimestamp()
    .setDescription(`Владелец: ${owner}\n\n🔒 — закрыть/открыть для всех\n✏️ — переименовать\n👥 — лимит мест (0 = без лимита)\n➡️ — передать владение\n👢 — кикнуть (отключить)`)
    .setFooter({ text: 'Haapsaly Bassline • Private' });
}

function panelRows(locked) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(BTN_LOCK).setEmoji(locked ? '🔓' : '🔒').setLabel(locked ? 'Открыть' : 'Закрыть').setStyle(locked ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(BTN_RENAME).setEmoji('✏️').setLabel('Название').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(BTN_LIMIT).setEmoji('👥').setLabel('Лимит').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(BTN_GIVE).setEmoji('➡️').setLabel('Передать').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(BTN_KICK).setEmoji('👢').setLabel('Кик').setStyle(ButtonStyle.Danger),
  )];
}

async function refreshPanel(client, channelId) {
  try {
    const d = state();
    const rec = d.privates[channelId];
    if (!rec?.msgId) return;
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch?.isTextBased?.() && !ch?.isVoiceBased?.()) return;
    // панель живёт в самой приватке? нет — панель шлём в текстовый? VoiceMaster шлёт в войс-чат.
    // У нас: сообщение в voice-textchat приватной комнаты (isTextBased у войсов = voice text).
    const msg = await ch.messages.fetch(rec.msgId).catch(() => null);
    if (!msg) return;
    const locked = await isLocked(ch);
    const owner = await client.users.fetch(rec.ownerId).catch(() => null);
    await msg.edit({ embeds: [panelEmbed(owner || rec.ownerId)], components: panelRows(locked) }).catch(() => {});
  } catch {}
}

async function isLocked(channel) {
  try {
    const ow = channel.permissionOverwrites.cache.get(channel.guild.id);
    return !!ow?.deny.has(PermissionFlagsBits.Connect);
  } catch { return false; }
}

function myRoom(userId) {
  const d = state();
  const id = Object.keys(d.privates || {}).find(cid => d.privates[cid].ownerId === userId);
  return id || null;
}

async function handleVoiceState(oldS, newS, client) {
  const genId = config.priv.generatorId;
  if (!genId) return;
  const member = newS.member || oldS.member;
  if (!member || member.user.bot) return;

  // Зашёл в генератор
  if (newS.channelId === genId) {
    // уже есть своя — кидаем туда
    const existing = myRoom(member.id);
    if (existing) {
      const ch = await client.channels.fetch(existing).catch(() => null);
      if (ch) {
        try { await member.voice.setChannel(ch); } catch {}
        return;
      } else {
        const d = state(); delete d.privates[existing]; save(d);
      }
    }
    try {
      const gen = await client.channels.fetch(genId).catch(() => null);
      const parent = config.priv.categoryId || gen?.parentId || null;
      const room = await member.guild.channels.create({
        name: roomName(member.user),
        type: ChannelType.GuildVoice,
        parent,
        userLimit: config.priv.defaultLimit || 0,
        bitrate: (config.priv.defaultBitrate || 64) * 1000,
        permissionOverwrites: [
          { id: member.id, allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers] },
        ],
      });
      const msg = await room.send({ embeds: [panelEmbed(member.user)], components: panelRows(false) }).catch(() => null);
      const d = state();
      d.privates[room.id] = { ownerId: member.id, msgId: msg?.id || null };
      save(d);
      try { await member.voice.setChannel(room); } catch {}
      logger.info(`[priv] created ${room.id} for ${member.user.tag}`);
    } catch (e) { logger.warn('[priv] create failed', e.message); }
    return;
  }

  // Вышел из отслеживаемой комнаты
  const leftId = oldS.channelId;
  if (!leftId || leftId === genId) return;
  const d = state();
  const rec = d.privates[leftId];
  if (!rec) return;
  const ch = await client.channels.fetch(leftId).catch(() => null);
  if (!ch) { delete d.privates[leftId]; save(d); return; }
  const members = [...(ch.members?.values() || [])].filter(m => !m.user.bot);
  if (!members.length) {
    try { await ch.delete('Private empty'); } catch {}
    delete d.privates[leftId]; save(d);
    logger.info(`[priv] deleted empty ${leftId}`);
    return;
  }
  // владелец ушёл, люди остались — передаём первому
  if (rec.ownerId && !members.some(m => m.id === rec.ownerId)) {
    rec.ownerId = members[0].id;
    save(d);
    await refreshPanel(client, leftId);
    ch.send(`➡️ Владелец ушёл — комната перешла к ${members[0]}.`).catch(() => {});
  }
}

// owner или админ бота
function canControl(interaction, ownerId) {
  if (interaction.user.id === ownerId) return true;
  if (config.adminIds.includes(interaction.user.id)) return true;
  const perms = interaction.memberPermissions;
  return !!perms?.has(PermissionFlagsBits.ManageChannels);
}

async function roomOf(interaction, client) {
  // комната = войс, где сидит жмущий (должен быть своей приваткой)
  const voiceId = interaction.member?.voice?.channelId;
  if (!voiceId) return { error: 'Зайди в свою приватку.' };
  const d = state();
  const rec = d.privates[voiceId];
  if (!rec) return { error: 'Это не приватная комната бота.' };
  const ch = await client.channels.fetch(voiceId).catch(() => null);
  if (!ch) return { error: 'Комната не найдена.' };
  return { channel: ch, rec };
}

async function handleInteraction(interaction, client) {
  const id = interaction.customId;

  if (interaction.isButton()) {
    if (id === BTN_LOCK) {
      const r = await roomOf(interaction, client);
      if (r.error) { await interaction.reply({ content: `❌ ${r.error}`, flags: MessageFlags.Ephemeral }).catch(() => {}); return true; }
      if (!canControl(interaction, r.rec.ownerId)) { await interaction.reply({ content: '❌ Только владелец.', flags: MessageFlags.Ephemeral }).catch(() => {}); return true; }
      const locked = await isLocked(r.channel);
      try {
        if (locked) await r.channel.permissionOverwrites.delete(interaction.guild.id);
        else await r.channel.permissionOverwrites.edit(interaction.guild.id, { Connect: false });
        await refreshPanel(client, r.channel.id);
        await interaction.reply({ content: locked ? '🔓 Открыто для всех.' : '🔒 Закрыто (только кто внутри + владелец).', flags: MessageFlags.Ephemeral }).catch(() => {});
      } catch { await interaction.reply({ content: '❌ Не смог (прав не хватает?).', flags: MessageFlags.Ephemeral }).catch(() => {}); }
      return true;
    }
    if (id === BTN_RENAME) {
      const r = await roomOf(interaction, client);
      if (r.error || !canControl(interaction, r.rec.ownerId)) { await interaction.reply({ content: `❌ ${r.error || 'Только владелец.'}`, flags: MessageFlags.Ephemeral }).catch(() => {}); return true; }
      const modal = new ModalBuilder().setCustomId(`${MODAL_RENAME}:${r.channel.id}`).setTitle('Название приватки');
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('name').setLabel('Новое название').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(2).setMaxLength(90),
      ));
      await interaction.showModal(modal).catch(() => {});
      return true;
    }
    if (id === BTN_LIMIT) {
      const r = await roomOf(interaction, client);
      if (r.error || !canControl(interaction, r.rec.ownerId)) { await interaction.reply({ content: `❌ ${r.error || 'Только владелец.'}`, flags: MessageFlags.Ephemeral }).catch(() => {}); return true; }
      const modal = new ModalBuilder().setCustomId(`${MODAL_LIMIT}:${r.channel.id}`).setTitle('Лимит мест (0 = без лимита)');
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('limit').setLabel('Число 0–99').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2),
      ));
      await interaction.showModal(modal).catch(() => {});
      return true;
    }
    if (id === BTN_GIVE || id === BTN_KICK) {
      const r = await roomOf(interaction, client);
      if (r.error || !canControl(interaction, r.rec.ownerId)) { await interaction.reply({ content: `❌ ${r.error || 'Только владелец.'}`, flags: MessageFlags.Ephemeral }).catch(() => {}); return true; }
      const inRoom = [...(r.channel.members?.values() || [])].filter(m => !m.user.bot && m.id !== interaction.user.id).slice(0, 20);
      if (!inRoom.length) { await interaction.reply({ content: '❌ В комнате никого кроме тебя.', flags: MessageFlags.Ephemeral }).catch(() => {}); return true; }
      const menu = new UserSelectMenuBuilder()
        .setCustomId(`${id === BTN_GIVE ? 'priv:dogive' : 'priv:dokick'}:${r.channel.id}`)
        .setPlaceholder(id === BTN_GIVE ? 'Кому передать?' : 'Кого кикнуть?')
        .setMinValues(1).setMaxValues(1);
      await interaction.reply({
        content: id === BTN_GIVE ? '➡️ Выбери нового владельца:' : '👢 Выбери кого отключить:',
        components: [new ActionRowBuilder().addComponents(menu)],
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith(MODAL_RENAME)) {
      const channelId = interaction.customId.split(':').pop();
      const d = state();
      if (d.privates[channelId]?.ownerId !== interaction.user.id && !config.adminIds.includes(interaction.user.id)) {
        await interaction.reply({ content: '❌ Только владелец.', flags: MessageFlags.Ephemeral }).catch(() => {}); return true;
      }
      const name = interaction.fields.getTextInputValue('name').trim();
      const ch = await client.channels.fetch(channelId).catch(() => null);
      if (!ch) { await interaction.reply({ content: '❌ Комната не найдена.', flags: MessageFlags.Ephemeral }).catch(() => {}); return true; }
      await ch.setName(name.slice(0, 90)).catch(() => {});
      await interaction.reply({ content: `✏️ Переименовано: **${name.slice(0, 90)}**`, flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }
    if (interaction.customId.startsWith(MODAL_LIMIT)) {
      const channelId = interaction.customId.split(':').pop();
      const d = state();
      if (d.privates[channelId]?.ownerId !== interaction.user.id && !config.adminIds.includes(interaction.user.id)) {
        await interaction.reply({ content: '❌ Только владелец.', flags: MessageFlags.Ephemeral }).catch(() => {}); return true;
      }
      const n = Number(interaction.fields.getTextInputValue('limit').trim());
      if (!Number.isInteger(n) || n < 0 || n > 99) {
        await interaction.reply({ content: '❌ Число 0–99.', flags: MessageFlags.Ephemeral }).catch(() => {}); return true;
      }
      const ch = await client.channels.fetch(channelId).catch(() => null);
      if (!ch) { await interaction.reply({ content: '❌ Комната не найдена.', flags: MessageFlags.Ephemeral }).catch(() => {}); return true; }
      await ch.setUserLimit(n).catch(() => {});
      await interaction.reply({ content: n === 0 ? '👥 Лимит снят.' : `👥 Лимит: ${n}.`, flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }
  }

  if (interaction.isUserSelectMenu()) {
    const [kind, channelId] = [interaction.customId.startsWith('priv:dogive') ? 'give' : 'kick', interaction.customId.split(':').pop()];
    const d = state();
    if (d.privates[channelId]?.ownerId !== interaction.user.id && !config.adminIds.includes(interaction.user.id)) {
      await interaction.reply({ content: '❌ Только владелец.', flags: MessageFlags.Ephemeral }).catch(() => {}); return true;
    }
    const targetId = interaction.values?.[0];
    if (!targetId) { await interaction.deferUpdate().catch(() => {}); return true; }
    if (kind === 'give') {
      d.privates[channelId].ownerId = targetId;
      save(d);
      await refreshPanel(client, channelId);
      await interaction.reply({ content: `➡️ Новый владелец: <@${targetId}>`, flags: MessageFlags.Ephemeral }).catch(() => {});
    } else {
      const member = await interaction.guild.members.fetch(targetId).catch(() => null);
      if (member?.voice?.channelId === channelId) {
        await member.voice.disconnect('Kicked from private').catch(() => {});
        await interaction.reply({ content: `👢 Отключён: <@${targetId}>`, flags: MessageFlags.Ephemeral }).catch(() => {});
      } else {
        await interaction.reply({ content: '❌ Его уже нет в комнате.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
    return true;
  }

  return false;
}

module.exports = { handleVoiceState, handleInteraction };
