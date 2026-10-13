// Private voices like VoiceMaster: join generator -> own room + panel.
// Controls are available only to the current room owner while they are in that room.
// Transfer and Kick only accept human members currently in the same room.
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
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

const dmCooldown = new Map(); // userId -> last failure-DM timestamp
const creating = new Set(); // userId -> room creation is in flight
const transfersInFlight = new Set(); // channelId -> manual ownership transfer in flight

function state() {
  const data = store.load();
  if (!data.privates || typeof data.privates !== 'object') {
    data.privates = {};
  }
  return data;
}

function save(data) {
  store.save(data);
}

function roomName(user) {
  const template = config.priv?.nameTemplate || "{user}'s room";
  const name = template.split('{user}').join(user.username).trim().slice(0, 90);
  return name || `${user.username}'s room`.slice(0, 90);
}

function panelEmbed(ownerId) {
  return new EmbedBuilder()
    .setColor(0x7c3aed)
    .setTitle('🔊 Your Private Room')
    .setTimestamp()
    .setDescription(
      `Owner: <@${ownerId}>\n\n` +
      '🔒 - lock/unlock for everyone\n' +
      '✏️ - rename\n' +
      '👥 - slot limit (0 = unlimited)\n' +
      '➡️ - transfer ownership\n' +
      '👢 - kick (disconnect)'
    )
    .setFooter({ text: 'Haapsaly Bassline • Private' });
}

function panelRows(locked) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(BTN_LOCK)
        .setEmoji(locked ? '🔓' : '🔒')
        .setLabel(locked ? 'Unlock' : 'Lock')
        .setStyle(locked ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(BTN_RENAME)
        .setEmoji('✏️')
        .setLabel('Rename')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(BTN_LIMIT)
        .setEmoji('👥')
        .setLabel('Limit')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(BTN_GIVE)
        .setEmoji('➡️')
        .setLabel('Transfer')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(BTN_KICK)
        .setEmoji('👢')
        .setLabel('Kick')
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

async function isLocked(channel) {
  try {
    const guildId = channel.guildId || channel.guild?.id;
    const overwrite = guildId
      ? channel.permissionOverwrites.cache.get(guildId)
      : null;
    return Boolean(overwrite?.deny.has(PermissionFlagsBits.Connect));
  } catch {
    return false;
  }
}

async function refreshPanel(client, channelId) {
  try {
    const record = state().privates[channelId];
    if (!record?.msgId) return;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildVoice) return;

    const message = await channel.messages.fetch(record.msgId).catch(() => null);
    if (!message) return;

    const locked = await isLocked(channel);
    await message.edit({
      embeds: [panelEmbed(record.ownerId)],
      components: panelRows(locked),
    }).catch(() => {});
  } catch (error) {
    logger.warn('[priv] panel refresh failed', error?.message || error);
  }
}

function myRoom(userId) {
  const records = state().privates;
  const channelId = Object.keys(records).find(
    (id) => records[id]?.ownerId === userId,
  );
  return channelId || null;
}

function replyError(interaction, message) {
  return interaction.reply({
    content: `❌ ${message}`,
    flags: MessageFlags.Ephemeral,
  }).catch(() => {});
}

// The panel must be the exact panel message recorded for this room.
async function resolveRoom(interaction, client, channelId, panelMessageId) {
  if (!interaction.guild || !channelId || !panelMessageId) {
    return { error: 'Invalid room control panel.' };
  }

  if (transfersInFlight.has(channelId)) {
    return { error: 'A room ownership transfer is in progress. Try again in a moment.' };
  }

  const record = state().privates[channelId];
  if (!record || !record.msgId || record.msgId !== panelMessageId) {
    return { error: 'This control panel is outdated or does not belong to this room.' };
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (
    !channel ||
    channel.type !== ChannelType.GuildVoice ||
    channel.guildId !== interaction.guildId
  ) {
    return { error: 'Private room not found.' };
  }

  return { channel, rec: record };
}

// Current owner only, and only while connected to this exact voice room.
// Server permissions such as ManageChannels do not grant access to bot controls.
async function controlError(interaction, ownerId, channelId) {
  if (!interaction.guild) {
    return 'This action can only be used in a server.';
  }

  if (interaction.user.id !== ownerId) {
    return 'Only the current owner of this room can use these controls.';
  }

  const member = await interaction.guild.members
    .fetch(interaction.user.id)
    .catch(() => null);

  if (!member) {
    return 'Could not verify your server membership. Try again.';
  }

  if (member.voice.channelId !== channelId) {
    return 'Join this exact private room before using its controls.';
  }

  return null;
}

async function roomOf(interaction, client) {
  const channelId = interaction.channelId;
  const panelMessageId = interaction.message?.id;
  const room = await resolveRoom(interaction, client, channelId, panelMessageId);
  if (room.error) return room;

  const denied = await controlError(interaction, room.rec.ownerId, room.channel.id);
  if (denied) return { error: denied };

  return room;
}

function parseRoomControlId(customId, prefix) {
  if (!customId.startsWith(`${prefix}:`)) return null;

  const values = customId.slice(prefix.length + 1).split(':');
  if (values.length !== 2 || !values[0] || !values[1]) return null;

  return {
    channelId: values[0],
    panelMessageId: values[1],
  };
}

async function grantOwnerPermissions(channel, userId, reason) {
  await channel.permissionOverwrites.edit(userId, {
    ViewChannel: true,
    Connect: true,
    ManageChannels: true,
    MoveMembers: true,
  }, reason);
}

// Remove the permissions granted by this module to the former owner.
// The explicit denies also override ordinary role-level ManageChannels/MoveMembers
// grants for this channel. Discord Administrator permissions cannot be overridden.
async function revokeOwnerPermissions(channel, userId, reason) {
  await channel.permissionOverwrites.edit(userId, {
    ViewChannel: null,
    Connect: null,
    ManageChannels: false,
    MoveMembers: false,
  }, reason);
}

function permissionState(overwrite, flag) {
  if (!overwrite) return null;
  if (overwrite.allow.has(flag)) return true;
  if (overwrite.deny.has(flag)) return false;
  return null;
}

function overwriteSnapshot(channel, userId) {
  const overwrite = channel.permissionOverwrites.cache.get(userId);
  return {
    exists: Boolean(overwrite),
    values: {
      ViewChannel: permissionState(overwrite, PermissionFlagsBits.ViewChannel),
      Connect: permissionState(overwrite, PermissionFlagsBits.Connect),
      ManageChannels: permissionState(overwrite, PermissionFlagsBits.ManageChannels),
      MoveMembers: permissionState(overwrite, PermissionFlagsBits.MoveMembers),
    },
  };
}

async function restoreOverwriteSnapshot(channel, userId, snapshot) {
  if (!snapshot.exists) {
    await channel.permissionOverwrites
      .delete(userId, 'Rollback failed private-room ownership transfer');
    return;
  }

  await channel.permissionOverwrites.edit(
    userId,
    snapshot.values,
    'Rollback failed private-room ownership transfer',
  );
}

async function transferOwnerAfterDeparture(
  client,
  channelId,
  channel,
  members,
  expectedOwnerId,
) {
  if (!members.length) return false;

  const nextOwner = members[0];
  let previousOwnerId = null;
  let changed = false;

  await store.exclusive(async () => {
    const data = state();
    const record = data.privates[channelId];
    if (!record) return;

    if (expectedOwnerId !== undefined && record.ownerId !== expectedOwnerId) {
      return;
    }

    if (record.ownerId && members.some((member) => member.id === record.ownerId)) {
      return;
    }

    previousOwnerId = record.ownerId || null;
    if (previousOwnerId === nextOwner.id) return;

    record.ownerId = nextOwner.id;
    save(data);
    changed = true;
  });

  if (!changed) return false;

  try {
    await grantOwnerPermissions(
      channel,
      nextOwner.id,
      'Private room ownership transferred after the previous owner left',
    );
  } catch (error) {
    logger.warn('[priv] failed to grant new owner permissions', error?.message || error);
  }

  if (previousOwnerId && previousOwnerId !== nextOwner.id) {
    try {
      await revokeOwnerPermissions(
        channel,
        previousOwnerId,
        'Private room ownership transferred after the previous owner left',
      );
    } catch (error) {
      logger.warn('[priv] failed to revoke former owner permissions', error?.message || error);
    }
  }

  await refreshPanel(client, channelId);
  await channel.send(`➡️ Owner left. The room is now owned by ${nextOwner}.`).catch(() => {});
  logger.info(`[priv] ownership of ${channelId} transferred to ${nextOwner.id}`);
  return true;
}

async function handleVoiceState(oldState, newState, client) {
  const generatorId = config.priv?.generatorId;
  if (!generatorId) return;

  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  // Join generator -> move to existing room or create a new one.
  if (newState.channelId === generatorId) {
    const existingId = myRoom(member.id);
    if (existingId) {
      const existingChannel = await client.channels.fetch(existingId).catch(() => null);
      if (existingChannel?.type === ChannelType.GuildVoice) {
        try {
          await member.voice.setChannel(existingChannel);
        } catch (error) {
          logger.warn('[priv] could not move member to existing room', error?.message || error);
        }
        return;
      }

      await store.exclusive(async () => {
        const data = state();
        delete data.privates[existingId];
        save(data);
      }).catch(() => {});
    }

    // Guard against two voiceStateUpdate events creating duplicate rooms.
    if (creating.has(member.id)) return;
    creating.add(member.id);

    try {
      // Re-check after acquiring the per-user creation guard.
      const existingAgain = myRoom(member.id);
      if (existingAgain) {
        const existingChannel = await client.channels.fetch(existingAgain).catch(() => null);
        if (existingChannel?.type === ChannelType.GuildVoice) {
          try {
            await member.voice.setChannel(existingChannel);
          } catch (error) {
            logger.warn('[priv] could not move member to existing room', error?.message || error);
          }
          return;
        }
      }

      const generator = await client.channels.fetch(generatorId).catch(() => null);
      const parent = config.priv?.categoryId || generator?.parentId || null;
      const limit = Math.min(Math.max(Number(config.priv?.defaultLimit) || 0, 0), 99);
      const bitrateKbps = Math.min(
        Math.max(Number(config.priv?.defaultBitrate) || 64, 8),
        384,
      );

      const room = await member.guild.channels.create({
        name: roomName(member.user),
        type: ChannelType.GuildVoice,
        parent,
        userLimit: limit,
        bitrate: bitrateKbps * 1000,
        permissionOverwrites: [
          {
            id: member.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.MoveMembers,
            ],
          },
        ],
      });

      const panelMessage = await room.send({
        embeds: [panelEmbed(member.id)],
        components: panelRows(false),
      }).catch(() => null);

      await store.exclusive(async () => {
        const data = state();
        data.privates[room.id] = {
          ownerId: member.id,
          msgId: panelMessage?.id || null,
        };
        save(data);
      });

      try {
        await member.voice.setChannel(room);
      } catch (error) {
        logger.warn('[priv] room created but member could not be moved', error?.message || error);
      }

      logger.info(`[priv] created ${room.id} for ${member.user.tag}`);
    } catch (error) {
      logger.warn('[priv] create failed', error?.message || error);

      // Throttle DMs when configuration or permissions are broken.
      const lastDm = dmCooldown.get(member.id) || 0;
      if (Date.now() - lastDm > 10 * 60 * 1000) {
        dmCooldown.set(member.id, Date.now());
        try {
          await member.user.send(
            `❌ Could not create your private room on **${member.guild?.name || 'the server'}**: ` +
            `${String(error?.message || error).slice(0, 200)}`,
          ).catch(() => {});
        } catch {
          // DMs may be disabled.
        }
      }
    } finally {
      creating.delete(member.id);
    }

    return;
  }

  // Process the room the member left.
  const leftChannelId = oldState.channelId;
  if (!leftChannelId || leftChannelId === generatorId) return;

  const recordBefore = state().privates[leftChannelId];
  if (!recordBefore) return;

  const channel = await client.channels.fetch(leftChannelId).catch(() => null);
  if (!channel) {
    await store.exclusive(async () => {
      const data = state();
      delete data.privates[leftChannelId];
      save(data);
    }).catch(() => {});
    return;
  }

  if (channel.type !== ChannelType.GuildVoice) {
    await store.exclusive(async () => {
      const data = state();
      delete data.privates[leftChannelId];
      save(data);
    }).catch(() => {});
    return;
  }

  const humans = [...channel.members.values()].filter((item) => !item.user.bot);
  if (!humans.length) {
    try {
      await channel.delete('Private room empty');
      await store.exclusive(async () => {
        const data = state();
        delete data.privates[leftChannelId];
        save(data);
      });
      logger.info(`[priv] deleted empty ${leftChannelId}`);
    } catch (error) {
      // Keep the record so a later startup sweep can retry deletion.
      logger.warn('[priv] failed to delete empty room', error?.message || error);
    }
    return;
  }

  if (!recordBefore.ownerId || !humans.some((item) => item.id === recordBefore.ownerId)) {
    await transferOwnerAfterDeparture(
      client,
      leftChannelId,
      channel,
      humans,
      recordBefore.ownerId,
    ).catch((error) => {
      logger.warn('[priv] owner handoff failed', error?.message || error);
    });
  }
}

async function handleInteraction(interaction, client) {
  const id = interaction.customId || '';

  if (interaction.isButton()) {
    if ([BTN_LOCK, BTN_RENAME, BTN_LIMIT, BTN_GIVE, BTN_KICK].includes(id)) {
      const room = await roomOf(interaction, client);
      if (room.error) {
        await replyError(interaction, room.error);
        return true;
      }

      if (id === BTN_LOCK) {
        try {
          const locked = await isLocked(room.channel);
          if (locked) {
            // Clear only the Connect override, preserving unrelated @everyone rules.
            await room.channel.permissionOverwrites.edit(
              room.channel.guildId,
              { Connect: null },
              'Private room unlocked by owner',
            );
          } else {
            await room.channel.permissionOverwrites.edit(
              room.channel.guildId,
              { Connect: false },
              'Private room locked by owner',
            );
          }

          await refreshPanel(client, room.channel.id);
          await interaction.reply({
            content: locked ? '🔓 Room unlocked.' : '🔒 Room locked.',
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
        } catch (error) {
          logger.warn('[priv] lock toggle failed', error?.message || error);
          await replyError(interaction, 'Could not change room access. Check the bot permissions.');
        }
        return true;
      }

      if (id === BTN_RENAME) {
        const modal = new ModalBuilder()
          .setCustomId(`${MODAL_RENAME}:${room.channel.id}:${room.rec.msgId}`)
          .setTitle('Private Room Name');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('name')
              .setLabel('New name')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMinLength(2)
              .setMaxLength(90),
          ),
        );

        try {
          await interaction.showModal(modal);
        } catch (error) {
          logger.warn('[priv] could not open rename modal', error?.message || error);
          await replyError(interaction, 'Could not open the rename form. Try again.');
        }
        return true;
      }

      if (id === BTN_LIMIT) {
        const modal = new ModalBuilder()
          .setCustomId(`${MODAL_LIMIT}:${room.channel.id}:${room.rec.msgId}`)
          .setTitle('Slot Limit (0 = unlimited)');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('limit')
              .setLabel('Number 0–99')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMinLength(1)
              .setMaxLength(2),
          ),
        );

        try {
          await interaction.showModal(modal);
        } catch (error) {
          logger.warn('[priv] could not open limit modal', error?.message || error);
          await replyError(interaction, 'Could not open the limit form. Try again.');
        }
        return true;
      }

      if (id === BTN_GIVE || id === BTN_KICK) {
        const otherHumans = [...room.channel.members.values()].filter(
          (item) => !item.user.bot && item.id !== room.rec.ownerId,
        );

        if (!otherHumans.length) {
          await replyError(interaction, 'No other human members are currently in this room.');
          return true;
        }

        const prefix = id === BTN_GIVE ? 'priv:dogive' : 'priv:dokick';
        const menu = new UserSelectMenuBuilder()
          .setCustomId(`${prefix}:${room.channel.id}:${room.rec.msgId}`)
          .setPlaceholder(id === BTN_GIVE ? 'Transfer to a member in this room' : 'Kick a member in this room')
          .setMinValues(1)
          .setMaxValues(1);

        await interaction.reply({
          content: id === BTN_GIVE
            ? '➡️ Select the new owner. They must currently be in this room.'
            : '👢 Select someone to disconnect. They must currently be in this room.',
          components: [new ActionRowBuilder().addComponents(menu)],
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return true;
      }
    }
  }

  if (interaction.isModalSubmit()) {
    let prefix = null;
    if (id.startsWith(`${MODAL_RENAME}:`)) prefix = MODAL_RENAME;
    else if (id.startsWith(`${MODAL_LIMIT}:`)) prefix = MODAL_LIMIT;
    else return false;

    const parsed = parseRoomControlId(id, prefix);
    if (!parsed) {
      await replyError(interaction, 'Invalid form. Reopen the room control panel and try again.');
      return true;
    }

    const room = await resolveRoom(
      interaction,
      client,
      parsed.channelId,
      parsed.panelMessageId,
    );
    if (room.error) {
      await replyError(interaction, room.error);
      return true;
    }

    const denied = await controlError(interaction, room.rec.ownerId, room.channel.id);
    if (denied) {
      await replyError(interaction, denied);
      return true;
    }

    if (prefix === MODAL_RENAME) {
      const name = interaction.fields.getTextInputValue('name').trim();
      if (name.length < 2 || name.length > 90) {
        await replyError(interaction, 'Room name must contain between 2 and 90 characters.');
        return true;
      }

      try {
        await room.channel.setName(name, 'Private room renamed by owner');
        await interaction.reply({
          content: `✏️ Room renamed to **${name}**.`,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
      } catch (error) {
        logger.warn('[priv] rename failed', error?.message || error);
        await replyError(interaction, 'Could not rename this room. Check the bot permissions.');
      }
      return true;
    }

    const limit = Number(interaction.fields.getTextInputValue('limit').trim());
    if (!Number.isInteger(limit) || limit < 0 || limit > 99) {
      await replyError(interaction, 'Enter a whole number from 0 to 99.');
      return true;
    }

    try {
      await room.channel.setUserLimit(limit, 'Private room limit changed by owner');
      await interaction.reply({
        content: limit === 0 ? '👥 User limit removed.' : `👥 User limit set to ${limit}.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      logger.warn('[priv] user limit update failed', error?.message || error);
      await replyError(interaction, 'Could not change the user limit. Check the bot permissions.');
    }
    return true;
  }

  if (interaction.isUserSelectMenu()) {
    let kind = null;
    let prefix = null;
    if (id.startsWith('priv:dogive:')) {
      kind = 'give';
      prefix = 'priv:dogive';
    } else if (id.startsWith('priv:dokick:')) {
      kind = 'kick';
      prefix = 'priv:dokick';
    } else {
      return false;
    }

    const parsed = parseRoomControlId(id, prefix);
    if (!parsed) {
      await replyError(interaction, 'Invalid selection. Reopen the room control panel and try again.');
      return true;
    }

    const room = await resolveRoom(
      interaction,
      client,
      parsed.channelId,
      parsed.panelMessageId,
    );
    if (room.error) {
      await replyError(interaction, room.error);
      return true;
    }

    const denied = await controlError(interaction, room.rec.ownerId, room.channel.id);
    if (denied) {
      await replyError(interaction, denied);
      return true;
    }

    const targetId = interaction.values?.[0];
    if (!targetId) {
      await replyError(interaction, 'No user was selected.');
      return true;
    }

    const target = await interaction.guild.members.fetch(targetId).catch(() => null);
    if (!target) {
      await replyError(interaction, 'That user is no longer on this server.');
      return true;
    }

    if (target.user.bot) {
      await replyError(interaction, 'Bots cannot own or be kicked from a private room using this menu.');
      return true;
    }

    if (target.id === room.rec.ownerId) {
      await replyError(interaction, 'You cannot select the current room owner.');
      return true;
    }

    // UserSelectMenu can show users outside the room, so validate the selected
    // member on submission instead of trusting the menu's visible options.
    if (target.voice.channelId !== room.channel.id) {
      await replyError(interaction, 'The selected user must currently be in this private room.');
      return true;
    }

    if (kind === 'kick') {
      try {
        await target.voice.disconnect('Kicked from private room by owner');
        await interaction.reply({
          content: `👢 Disconnected <@${target.id}> from the room.`,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
      } catch (error) {
        logger.warn('[priv] kick failed', error?.message || error);
        await replyError(interaction, 'Could not disconnect that member. Check the bot permissions.');
      }
      return true;
    }

    if (transfersInFlight.has(room.channel.id)) {
      await replyError(interaction, 'An ownership transfer is already in progress for this room.');
      return true;
    }

    transfersInFlight.add(room.channel.id);
    try {
      const previousOwnerId = room.rec.ownerId;
      const targetSnapshot = overwriteSnapshot(room.channel, target.id);
      const previousOwnerSnapshot = overwriteSnapshot(room.channel, previousOwnerId);

      try {
        await grantOwnerPermissions(
          room.channel,
          target.id,
          'Private room ownership transferred by the current owner',
        );
        await revokeOwnerPermissions(
          room.channel,
          previousOwnerId,
          'Private room ownership transferred by the current owner',
        );
      } catch (error) {
        await restoreOverwriteSnapshot(room.channel, target.id, targetSnapshot).catch(() => {});
        await restoreOverwriteSnapshot(room.channel, previousOwnerId, previousOwnerSnapshot).catch(() => {});
        logger.warn('[priv] transfer permission update failed', error?.message || error);
        await replyError(interaction, 'Could not update room permissions. Ownership was not changed.');
        return true;
      }

      let updated = false;
      try {
        await store.exclusive(async () => {
          const data = state();
          const current = data.privates[room.channel.id];
          if (!current || current.ownerId !== previousOwnerId) return;

          current.ownerId = target.id;
          save(data);
          updated = true;
        });
      } catch (error) {
        logger.warn('[priv] transfer state update failed', error?.message || error);
      }

      if (!updated) {
        await restoreOverwriteSnapshot(room.channel, target.id, targetSnapshot).catch(() => {});
        await restoreOverwriteSnapshot(room.channel, previousOwnerId, previousOwnerSnapshot).catch(() => {});
        await replyError(interaction, 'Room ownership changed while this action was running. Please reopen the panel.');
        return true;
      }

      await refreshPanel(client, room.channel.id);
      await interaction.reply({
        content: `➡️ New room owner: <@${target.id}>`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      }).catch(() => {});
      logger.info(`[priv] ownership of ${room.channel.id} transferred from ${previousOwnerId} to ${target.id}`);
    } finally {
      transfersInFlight.delete(room.channel.id);
    }

    return true;
  }

  return false;
}

// Startup cleanup: remove missing/empty rooms and repair ownership if the bot was offline.
async function sweepOrphans(client) {
  if (!config.priv?.generatorId) return;

  const deadIds = [];
  const ownerRepairs = [];

  try {
    const channelIds = Object.keys(state().privates);
    for (const channelId of channelIds) {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildVoice) {
        deadIds.push(channelId);
        continue;
      }

      const humans = [...channel.members.values()].filter((member) => !member.user.bot);
      if (!humans.length) {
        try {
          await channel.delete('Private room empty (startup sweep)');
          deadIds.push(channelId);
        } catch (error) {
          logger.warn('[priv] startup sweep could not delete empty room', error?.message || error);
        }
        continue;
      }

      const record = state().privates[channelId];
      if (!record?.ownerId || !humans.some((member) => member.id === record.ownerId)) {
        ownerRepairs.push({ channelId, channel, humans, expectedOwnerId: record?.ownerId });
      }
    }

    if (deadIds.length) {
      await store.exclusive(async () => {
        const data = state();
        for (const channelId of deadIds) delete data.privates[channelId];
        save(data);
      });
      logger.info(`[priv] startup sweep cleaned ${deadIds.length} missing/empty room record(s)`);
    }

    for (const repair of ownerRepairs) {
      await transferOwnerAfterDeparture(
        client,
        repair.channelId,
        repair.channel,
        repair.humans,
        repair.expectedOwnerId,
      ).catch((error) => {
        logger.warn('[priv] startup owner repair failed', error?.message || error);
      });
    }
  } catch (error) {
    logger.warn('[priv] startup sweep failed', error?.message || error);
  }
}

module.exports = {
  handleVoiceState,
  handleInteraction,
  sweepOrphans,
};