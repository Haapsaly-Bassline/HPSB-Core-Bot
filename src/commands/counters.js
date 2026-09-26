const { SlashCommandBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { snapshot, TYPES, channelIdsFor, templateFor, isEnabled, renderName } = require('../modules/stats/counter');
const { requireMod } = require('../utils/mod');
const { config } = require('../config');
const store = require('../utils/store');

function fmt(n) { return Number(n || 0).toLocaleString('ru-RU'); }

const TYPE_CHOICES = TYPES.map(t => ({ name: t, value: t }));

function asArray(v) {
  if (!v) return [];
  return Array.isArray(v) ? v.filter(Boolean) : [v];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('counters')
    .setDescription('Счётчики Member Count: setup/list/on/off/link/template')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('setup').setDescription('Создать категорию 📊 и все счётчики')
      .addRoleOption(o => o.setName('role').setDescription('Роль для role-счётчика').setRequired(false)))
    .addSubcommand(s => s.setName('list').setDescription('Статус всех счётчиков'))
    .addSubcommand(s => s.setName('toggle').setDescription('Вкл/выкл счётчик (выкл удаляет его каналы)')
      .addStringOption(o => o.setName('type').setDescription('Тип').setRequired(true).addChoices(...TYPE_CHOICES))
      .addBooleanOption(o => o.setName('on').setDescription('Вкл?').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('Роль для role-счётчика').setRequired(false)))
    .addSubcommand(s => s.setName('link').setDescription('Привязать ЕЩЁ канал к счётчику')
      .addStringOption(o => o.setName('type').setDescription('Тип').setRequired(true).addChoices(...TYPE_CHOICES))
      .addChannelOption(o => o.setName('channel').setDescription('Канал (войс/текст)').setRequired(true)))
    .addSubcommand(s => s.setName('unlink').setDescription('Отвязать канал от счётчика (канал не удаляется)')
      .addStringOption(o => o.setName('type').setDescription('Тип').setRequired(true).addChoices(...TYPE_CHOICES))
      .addChannelOption(o => o.setName('channel').setDescription('Канал').setRequired(true)))
    .addSubcommand(s => s.setName('template').setDescription('Шаблон имени, {count} — число')
      .addStringOption(o => o.setName('type').setDescription('Тип').setRequired(true).addChoices(...TYPE_CHOICES))
      .addStringOption(o => o.setName('text').setDescription('Напр. Members: {count}').setRequired(true).setMaxLength(100))),

  async execute(interaction, client) {
    if (!await requireMod(interaction)) return;
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (sub === 'setup') {
      try {
        const data = store.load();
        data.statsChannels = data.statsChannels || {};
        const roleOpt = interaction.options.getRole('role');
        if (roleOpt) data.statsRoleId = roleOpt.id;
        // Идемпотентность: уже настроенные типы не трогаем (иначе дубли каналов)
        const already = [];
        const order = ['members', 'humans', 'bots', 'role', 'online', 'offline', 'roles', 'channels', 'boosts'];
        const missing = order.filter(key => {
          if (key === 'role' && !(data.statsRoleId || config.stats.roleId)) return false;
          const has = channelIdsFor(key).length > 0;
          if (has) already.push(key);
          return !has;
        });
        if (!missing.length) {
          await interaction.editReply('✅ Все счётчики уже настроены — дубли не создаю. Смотри /counters list.');
          return;
        }
        const cat = await interaction.guild.channels.create({
          name: '📊 Server Stats 📊', type: ChannelType.GuildCategory,
        });
        const made = [];
        for (const key of missing) {
          const ch = await interaction.guild.channels.create({
            name: renderName(key, 0).replace(/[\d\s.,]+$/, '').trim() || key,
            type: ChannelType.GuildVoice, parent: cat.id,
            permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionFlagsBits.Connect] }],
          });
          const cur = asArray(data.statsChannels[key]);
          cur.push(ch.id);
          data.statsChannels[key] = cur.length === 1 ? cur[0] : cur;
          made.push(`${key} → <#${ch.id}>`);
        }
        const dis = data.statsDisabled || [];
        data.statsDisabled = dis.filter(k => order.includes(k));
        store.save(data);
        const skipNote = already.length ? `\n\nПропущены (уже есть): ${already.join(', ')}` : '';
        await interaction.editReply(`✅ Категория ${cat} + счётчики:\n${made.join('\n')}${skipNote}\n\nИмена обновятся при следующем тике (≤10 мин). Шаблоны — /counters template.`);
      } catch (e) {
        await interaction.editReply(`❌ Не смог создать (нужны Manage Channels): ${String(e.message || e).slice(0, 200)}`);
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
        const extra = t === 'role' ? ` (роль: ${data.statsRoleId ? `<@&${data.statsRoleId}>` : 'не задана'})` : '';
        return `${on} **${t}** → ${ids.length ? ids.map(id => `<#${id}>`).join(' ') : '—'} \`${tpl}\`${extra}`;
      });
      const anyChannel = TYPES.some(t => channelIdsFor(t).length > 0);
      const noPresence = (channelIdsFor('online').length || channelIdsFor('offline').length) && s && !s.presenceSeen;
      const e = new EmbedBuilder().setColor(0x7c3aed).setTitle('📊 Счётчики').setTimestamp()
        .setDescription(lines.join('\n').slice(0, 3400)
          + (noPresence ? '\n\n⚠️ online/offline стоят, но presences нет — включи **Presence Intent** в Portal и перезапусти бота.' : '')
          + (!anyChannel ? '\n\n⚠️ Ни один счётчик не привязан к каналу — запусти **/counters setup**.' : ''))
        .setFooter({ text: s ? `Сейчас: ${fmt(s.total)} уч. • ${fmt(s.online)} онлайн` : 'Haapsaly Bassline' });
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
        await interaction.editReply('❌ Для role-счётчика укажи роль параметром.');
        return;
      }

      if (!on) {
        // Выкл: останавливаем обновления + СНОСИМ созданные каналы (все привязанные)
        if (!data.statsDisabled.includes(type)) data.statsDisabled.push(type);
        const stored = asArray(data.statsChannels[type]);
        const envId = config.stats[type];
        let deleted = 0;
        for (const sid of stored) {
          const ch = await interaction.guild.channels.fetch(sid).catch(() => null);
          if (ch) {
            await ch.delete('Counter disabled').catch(() => {});
            deleted++;
          }
        }
        if (stored.length) delete data.statsChannels[type];
        store.save(data);
        await interaction.editReply(
          deleted ? `⚪ Выключен + каналов удалено: ${deleted} (**${type}**)`
          : envId ? `⚪ Выключен (обновления остановлены): **${type}**\nКанал из .env не трогаю — удали руками если надо.`
          : `⚪ Выключен: **${type}**`
        );
        return;
      }

      // Вкл: снимаем флаг + создаём канал если вообще ни одного нет
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
        store.save(data);
        await interaction.editReply(`🟢 Включён + канал создан: **${type}** → <#${ch.id}>\nИмя обновится при следующем тике (≤10 мин).`);
      } else {
        store.save(data);
        await interaction.editReply(`🟢 Включён: **${type}** (${alive.length} кан.)`);
      }
      return;
    }

    if (sub === 'link') {
      const type = interaction.options.getString('type', true);
      const ch = interaction.options.getChannel('channel', true);
      const data = store.load();
      data.statsChannels = data.statsChannels || {};
      const cur = asArray(data.statsChannels[type]);
      if (cur.includes(ch.id)) {
        await interaction.editReply(`ℹ️ <#${ch.id}> уже привязан к **${type}**.`);
        return;
      }
      cur.push(ch.id);
      data.statsChannels[type] = cur.length === 1 ? cur[0] : cur;
      // раз привязали — включаем
      data.statsDisabled = (data.statsDisabled || []).filter(k => k !== type);
      store.save(data);
      await interaction.editReply(`🔗 Привязан: **${type}** → <#${ch.id}> (всего каналов: ${cur.length}). Имя обновится при следующем тике.`);
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
          ? '❌ Этот канал задан в .env — убери его там, из Discord не отвязать.'
          : `ℹ️ <#${ch.id}> не привязан к **${type}**.`);
        return;
      }
      const rest = cur.filter(id => id !== ch.id);
      if (rest.length) data.statsChannels[type] = rest.length === 1 ? rest[0] : rest;
      else delete data.statsChannels[type];
      store.save(data);
      await interaction.editReply(`🔓 Отвязан (канал НЕ удалён): **${type}** ✕ <#${ch.id}>. Осталось каналов: ${rest.length}.`);
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
      await interaction.editReply(`✅ Шаблон **${type}**: \`${text}\`\nПрименится при следующем тике.`);
      return;
    }
  },
};
