const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder, ChannelType, GuildOnboardingPromptType } = require('discord.js');
const { requireMod } = require('../utils/mod');

function roleJson(r) {
  return {
    id: r.id, name: r.name,
    color: r.color, hoist: r.hoist, mentionable: r.mentionable,
    permissions: r.permissions.bitfield.toString(),
    position: r.position, managed: r.managed,
    tags: r.tags ? { botId: r.tags.botId || null, integrationId: r.tags.integrationId || null, premiumSubscriber: !!r.tags.premiumSubscriberRole } : null,
  };
}

function overwritesJson(ch) {
  const ows = ch.permissionOverwrites?.cache ? [...ch.permissionOverwrites.cache.values()] : [];
  return ows.map(ow => ({
    id: ow.id, type: ow.type === 0 ? 'role' : 'member',
    allow: ow.allow.bitfield.toString(), deny: ow.deny.bitfield.toString(),
  }));
}

function channelJson(ch) {
  const base = {
    id: ch.id, name: ch.name, type: ch.type,
    typeName: ChannelType[ch.type] || String(ch.type),
    position: ch.position, parentId: ch.parentId || null,
    overwrites: overwritesJson(ch),
  };
  if (ch.isTextBased?.() && !ch.isVoiceBased?.()) {
    base.topic = ch.topic || null;
    base.nsfw = !!ch.nsfw;
    base.rateLimitPerUser = ch.rateLimitPerUser || 0;
    base.defaultAutoArchiveDuration = ch.defaultAutoArchiveDuration ?? null;
  }
  if (ch.isVoiceBased?.()) {
    base.bitrate = ch.bitrate;
    base.userLimit = ch.userLimit;
    base.rtcRegion = ch.rtcRegion || null;
  }
  return base;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dump')
    .setDescription('Слепок сервера в JSON (для бота-пересоздателя)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('what').setDescription('Что выгрузить')
      .addChoices(
        { name: 'Всё', value: 'full' },
        { name: 'Только роли', value: 'roles' },
        { name: 'Только каналы', value: 'channels' },
        { name: 'Только настройки', value: 'settings' },
      )),
  async execute(interaction, client) {
    if (!await requireMod(interaction)) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const g = interaction.guild;
    const what = interaction.options.getString('what') || 'full';
    try { await g.members.fetch().catch(() => {}); } catch {}

    const out = {
      exportedAt: new Date().toISOString(),
      guildId: g.id,
      note: 'ID старые — боту-пересоздателю маппить по name. Права — bitfield строкой.',
    };

    if (what === 'full' || what === 'settings') {
      out.guild = {
        name: g.name, description: g.description || null,
        afkChannelId: g.afkChannelId, afkTimeout: g.afkTimeout,
        verificationLevel: g.verificationLevel,
        defaultMessageNotifications: g.defaultMessageNotifications,
        explicitContentFilter: g.explicitContentFilter,
        premiumTier: g.premiumTier, premiumSubscriptionCount: g.premiumSubscriptionCount || 0,
        vanityURLCode: g.vanityURLCode || null, features: g.features,
        iconURL: g.iconURL({ size: 1024 }), bannerURL: g.bannerURL?.({ size: 1024 }) || g.bannerURL?.() || null,
        memberCount: g.memberCount,
        preferredLocale: g.preferredLocale,
      };
      out.emojis = [...g.emojis.cache.values()].map(e => ({ id: e.id, name: e.name, animated: e.animated, url: e.url }));
      out.stickers = [...g.stickers.cache.values()].map(s => ({ id: s.id, name: s.name, url: s.url }));
      out.rulesChannelId = g.rulesChannelId || null;
      out.publicUpdatesChannelId = g.publicUpdatesChannelId || null;
      out.safetyAlertsChannelId = g.safetyAlertsChannelId || null;
      // Экран приветствия (Server Guide)
      try {
        const ws = await g.fetchWelcomeScreen().catch(() => null);
        out.welcomeScreen = ws ? {
          description: ws.description || null,
          channels: (ws.welcomeChannels || []).map(c => ({
            channelId: c.channelId, description: c.description,
            emoji: c.emoji?.name || c.emoji || null,
          })),
        } : null;
      } catch { out.welcomeScreen = null; }
      // Онбординг: вопросы, варианты и привязанные роли
      try {
        const ob = await g.fetchOnboarding().catch(() => null);
        out.onboarding = ob ? {
          enabled: !!ob.enabled,
          defaultChannelIds: ob.defaultChannelIds || [],
          prompts: (ob.prompts || []).map(p => ({
            id: p.id, title: p.title, type: GuildOnboardingPromptType[p.type] ?? p.type,
            singleSelect: !!p.singleSelect, required: !!p.required, inOnboarding: !!p.inOnboarding,
            options: (p.options || []).map(o => ({
              id: o.id, title: o.title, description: o.description || null,
              roleIds: o.roleIds || [], emoji: o.emoji?.name || o.emoji || null,
            })),
          })),
        } : null;
      } catch { out.onboarding = null; }
    }
    if (what === 'full' || what === 'roles') {
      out.roles = [...g.roles.cache.values()]
        .sort((a, b) => b.position - a.position)
        .map(roleJson);
      out.roleMembers = {};
      for (const r of g.roles.cache.values()) {
        if (r.id === g.id || r.managed) continue;
        out.roleMembers[r.id] = [...g.members.cache.values()].filter(m => m.roles.cache.has(r.id)).map(m => m.id);
      }
    }
    if (what === 'full' || what === 'channels') {
      const cats = [...g.channels.cache.values()]
        .filter(c => c.type === ChannelType.GuildCategory)
        .sort((a, b) => a.position - b.position);
      const others = [...g.channels.cache.values()]
        .filter(c => c.type !== ChannelType.GuildCategory)
        .sort((a, b) => a.position - b.position);
      out.categories = cats.map(c => ({ id: c.id, name: c.name, position: c.position, overwrites: overwritesJson(c) }));
      out.channels = others.map(channelJson);
      try {
        const threads = await g.channels.fetchActiveThreads().catch(() => null);
        out.activeThreads = threads ? [...threads.threads.values()].map(t => ({
          id: t.id, name: t.name, parentId: t.parentId, archived: t.archived, locked: !!t.locked,
        })) : [];
      } catch { out.activeThreads = []; }
    }

    const buf = Buffer.from(JSON.stringify(out, null, 2), 'utf8');
    const counts = [
      out.roles ? `${out.roles.length} ролей` : null,
      out.channels ? `${out.channels.length} каналов + ${out.categories?.length || 0} разделов` : null,
      out.guild ? `эмодзи: ${out.emojis.length}, стикеры: ${out.stickers.length}` : null,
    ].filter(Boolean).join(', ');
    const e = new EmbedBuilder().setColor(0x7c3aed).setTitle('📦 Дамп сервера').setTimestamp()
      .setDescription(`\`${what}\`: ${counts || '—'}\n${(buf.length / 1024).toFixed(1)} КБ\n\nДля пересоздания: роли — по \`position\` сверху вниз (кроме managed-ботов), каналы — по разделам, оверврайты — по старым ID→именам.`)
      .setFooter({ text: 'Haapsaly Bassline' });
    await interaction.editReply({
      embeds: [e],
      files: [{ attachment: buf, name: `hpsb-dump-${what}-${Date.now()}.json` }],
    });
  },
};
