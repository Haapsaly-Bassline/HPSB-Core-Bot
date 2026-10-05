const { SlashCommandBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { snapshot, TYPES, channelIdsFor, templateFor, isEnabled, renderName } = require('../modules/stats/counter');
const { requireMod, requirePower } = require('../utils/mod');
const { config } = require('../config');
const store = require('../utils/store');

function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }

const TYPE_CHOICES = TYPES.map(t => ({ name: t, value: t }));

function asArray(v) {
  if (!v) return [];
  return Array.isArray(v) ? v.filter(Boolean) : [v];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('counters')
    .setDescription('Member Count counters: setup/list/on/off/link/template')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('setup').setDescription('Create 📊 category and all counters')
      .addRoleOption(o => o.setName('role').setDescription('Role for role counter').setRequired(false)))
    .addSubcommand(s => s.setName('list').setDescription('Status of all counters'))
    .addSubcommand(s => s.setName('toggle').setDescription('Enable/disable counter (disable deletes its channels)')
      .addStringOption(o => o.setName('type').setDescription('Type').setRequired(true).addChoices(...TYPE_CHOICES))
      .addBooleanOption(o => o.setName('on').setDescription('On?').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('Role for role counter').setRequired(false)))
    .addSubcommand(s => s.setName('link').setDescription('Link ANOTHER voice channel to counter')
      .addStringOption(o => o.setName('type').setDescription('Type').setRequired(true).addChoices(...TYPE_CHOICES))
      .addChannelOption(o => o.setName('channel').setDescription('Voice channel').setRequired(true)))
    .addSubcommand(s => s.setName('unlink').setDescription('Unlink channel from counter (channel not deleted)')
      .addStringOption(o => o.setName('type').setDescription('Type').setRequired(true).addChoices(...TYPE_CHOICES))
      .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true)))
    .addSubcommand(s => s.setName('template').setDescription('Name template, {count} = number')
      .addStringOption(o => o.setName('type').setDescription('Type').setRequired(true).addChoices(...TYPE_CHOICES))
      .addStringOption(o => o.setName('text').setDescription('E.g. Members: {count}').setRequired(true).setMaxLength(100))),

  async execute(interaction, client) {
    if (!await requireMod(interaction)) return;
    const sub = interaction.options.getSubcommand();
    // Channel create/delete needs Manage Channels (requireMod alone is not enough)
    if (['setup', 'toggle', 'link', 'unlink'].includes(sub)) {
      if (!await requirePower(interaction, PermissionFlagsBits.ManageChannels, 'Manage Channels')) return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Stored ids of channels the BOT created (only those may be auto-deleted).
    async function markCreated(ids) {
      const data = store.load();
      const set = new Set(Array.isArray(data.statsCreatedIds) ? data.statsCreatedIds : []);
      for (const id of ids) set.add(id);
      data.statsCreatedIds = [...set];
      store.save(data);
    }
    function isBotCreated(id) {
      try {
        const data = store.load();
        return Array.isArray(data.statsCreatedIds) && data.statsCreatedIds.includes(id);
      } catch { return false; }
    }
    // Stored id counts only if the channel still exists (deleted manually -> recreate).
    async function aliveIds(ids) {
      const out = [];
      for (const id of ids) {
        const ch = await interaction.guild.channels.fetch(id).catch(() => null);
        if (ch) out.push(id);
      }
      return out;
    }

    if (sub === 'setup') {
      try {
        const data = store.load();
        data.statsChannels = data.statsChannels || {};
        const roleOpt = interaction.options.getRole('role');
        if (roleOpt) data.statsRoleId = roleOpt.id;
        // Idempotency: already configured AND alive types untouched (otherwise duplicate channels)
        const already = [];
        const order = ['members', 'humans', 'bots', 'role', 'online', 'offline', 'roles', 'channels', 'boosts'];
        const missing = [];
        for (const key of order) {
          if (key === 'role' && !(data.statsRoleId || config.stats.roleId)) continue;
          const alive = await aliveIds(channelIdsFor(key));
          if (alive.length) already.push(key);
          else missing.push(key);
        }
        if (!missing.length) {
          await interaction.editReply('✅ All counters already set up -- not creating duplicates. See /counters list.');
          return;
        }
        const cat = await interaction.guild.channels.create({
          name: '📊 Server Stats 📊', type: ChannelType.GuildCategory,
        });
        const made = [];
        const madeIds = [];
        for (const key of missing) {
          const ch = await interaction.guild.channels.create({
            name: renderName(key, 0).replace(/[\d\s.,]+$/, '').trim() || key,
            type: ChannelType.GuildVoice, parent: cat.id,
            permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionFlagsBits.Connect] }],
          });
          const cur = asArray(data.statsChannels[key]);
          cur.push(ch.id);
          data.statsChannels[key] = cur.length === 1 ? cur[0] : cur;
          made.push(`${key} -> <#${ch.id}>`);
          madeIds.push(ch.id);
        }
        await markCreated(madeIds);
        const dis = data.statsDisabled || [];
        data.statsDisabled = dis.filter(k => order.includes(k));
        store.save(data);
        const skipNote = already.length ? `\n\nSkipped (already exist): ${already.join(', ')}` : '';
        await interaction.editReply(`✅ Category ${cat} + counters:\n${made.join('\n')}${skipNote}\n\nNames update on next tick (≤10 min). Templates via /counters template.`);
      } catch (e) {
        await interaction.editReply(`❌ Could not create (need Manage Channels): ${String(e.message || e).slice(0, 200)}`);
      }
      return;
    }

    if (sub === 'list') {
      const s = await snapshot(client).catch(() => null);
      const data = store.load();
      const lines = TYPES.map(t => {
        const on = isEnabled(t) ? '🟢' : '⚪';
        const ids = channelIdsFor(t);
        const tpl = templateFor(t);
        const extra = t === 'role' ? ` (role: ${data.statsRoleId ? `<@&${data.statsRoleId}>` : 'not set'})` : '';
        return `${on} **${t}** -> ${ids.length ? ids.map(id => `<#${id}>`).join(' ') : '-'} \`${tpl}\`${extra}`;
      });
      const anyChannel = TYPES.some(t => channelIdsFor(t).length > 0);
      const noPresence = (channelIdsFor('online').length || channelIdsFor('offline').length) && s && !s.presenceSeen;
      const e = new EmbedBuilder().setColor(0x7c3aed).setTitle('📊 Counters').setTimestamp()
        .setDescription(lines.join('\n').slice(0, 3400)
          + (noPresence ? '\n\n⚠️ online/offline set but no presences -- enable **Presence Intent** in Portal and restart bot.' : '')
          + (!anyChannel ? '\n\n⚠️ No counter linked to channel -- run **/counters setup**.' : ''))
        .setFooter({ text: s ? `Now: ${fmt(s.total)} members • ${fmt(s.online)} online` : 'Haapsaly Bassline' });
      await interaction.editReply({ embeds: [e] });
      return;
    }

    if (sub === 'toggle') {
      const type = interaction.options.getString('type', true);
      const on = interaction.options.getBoolean('on', true);
      const roleOpt = interaction.options.getRole('role');
      const data = store.load();
      data.statsDisabled = data.statsDisabled || [];
      data.statsChannels = data.statsChannels || {};
      if (type === 'role' && roleOpt) data.statsRoleId = roleOpt.id;
      if (type === 'role' && on && !(data.statsRoleId || config.stats.roleId)) {
        await interaction.editReply('❌ For role counter specify role as parameter.');
        return;
      }

      if (!on) {
        // Disable: stop updates + delete ONLY bot-created channels (never production ones)
        if (!data.statsDisabled.includes(type)) data.statsDisabled.push(type);
        const stored = asArray(data.statsChannels[type]);
        const envId = config.stats[type];
        let deleted = 0, kept = 0;
        for (const sid of stored) {
          if (!isBotCreated(sid)) { kept++; continue; }
          const ch = await interaction.guild.channels.fetch(sid).catch(() => null);
          if (ch) {
            await ch.delete('Counter disabled').catch(() => {});
            deleted++;
          }
        }
        if (stored.length) delete data.statsChannels[type];
        store.save(data);
        await interaction.editReply(
          deleted ? `⚪ Disabled + bot channels deleted: ${deleted} (**${type}**)${kept ? `, kept (not ours): ${kept}` : ''}`
            : envId ? `⚪ Disabled (updates stopped): **${type}**\nChannel from .env not touched -- delete manually if needed.`
            : `⚪ Disabled: **${type}**`
        );
        return;
      }

      // Enable: clear flag + create channel if none at all
      data.statsDisabled = data.statsDisabled.filter(k => k !== type);
      const ids = channelIdsFor(type);
      const alive = [];
      for (const cid of ids) {
        const ch = await interaction.guild.channels.fetch(cid).catch(() => null);
        if (ch) alive.push(cid);
      }
      if (!alive.length) {
        let cat = interaction.guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.includes('Server Stats'));
        if (!cat) {
          cat = await interaction.guild.channels.create({ name: '📊 Server Stats 📊', type: ChannelType.GuildCategory });
        }
        const ch = await interaction.guild.channels.create({
          name: renderName(type, 0).replace(/[\d\s.,]+$/, '').trim() || type,
          type: ChannelType.GuildVoice, parent: cat.id,
          permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionFlagsBits.Connect] }],
        });
        data.statsChannels[type] = ch.id;
        await markCreated([ch.id]);
        store.save(data);
        await interaction.editReply(`🟢 Enabled + channel created: **${type}** -> <#${ch.id}>\nName updates on next tick (<=10 min).`);
      } else {
        store.save(data);
        await interaction.editReply(`🟢 Enabled: **${type}** (${alive.length} ch.)`);
      }
      return;
    }

    if (sub === 'link') {
      const type = interaction.options.getString('type', true);
      const ch = interaction.options.getChannel('channel', true);
      // Counters rename whatever they track -- voice only, or a production chat gets renamed.
      if (!ch.isVoiceBased?.()) {
        await interaction.editReply('❌ Voice channels only (counters rename the channel).');
        return;
      }
      const data = store.load();
      data.statsChannels = data.statsChannels || {};
      const cur = asArray(data.statsChannels[type]);
      if (cur.includes(ch.id)) {
        await interaction.editReply(`ℹ️ <#${ch.id}> already linked to **${type}**.`);
        return;
      }
      cur.push(ch.id);
      data.statsChannels[type] = cur.length === 1 ? cur[0] : cur;
      // now linked -- enable
      data.statsDisabled = (data.statsDisabled || []).filter(k => k !== type);
      store.save(data);
      await interaction.editReply(`🔗 Linked: **${type}** -> <#${ch.id}> (total channels: ${cur.length}). Name updates on next tick.`);
      return;
    }

    if (sub === 'unlink') {
      const type = interaction.options.getString('type', true);
      const ch = interaction.options.getChannel('channel', true);
      const data = store.load();
      const cur = asArray(data.statsChannels[type]);
      if (!cur.includes(ch.id)) {
        const envHit = config.stats[type] === ch.id;
        await interaction.editReply(envHit
          ? '❌ This channel is set in .env -- remove it there, cannot unlink from Discord.'
          : `ℹ️ <#${ch.id}> not linked to **${type}**.`);
        return;
      }
      const rest = cur.filter(id => id !== ch.id);
      if (rest.length) data.statsChannels[type] = rest.length === 1 ? rest[0] : rest;
      else delete data.statsChannels[type];
      store.save(data);
      await interaction.editReply(`🔓 Unlinked (channel NOT deleted): **${type}** ✕ <#${ch.id}>. Remaining channels: ${rest.length}.`);
      return;
    }

    if (sub === 'template') {
      const type = interaction.options.getString('type', true);
      let text = interaction.options.getString('text', true).slice(0, 100);
      if (!text.includes('{count}')) text += ' {count}';
      const data = store.load();
      data.statsTemplates = data.statsTemplates || {};
      data.statsTemplates[type] = text;
      store.save(data);
      await interaction.editReply(`✅ Template **${type}**: \`${text}\`\nApplies on next tick.`);
      return;
    }
  },
};
