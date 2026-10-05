// /honeypot: trap status + dry-run test (why doesn't it punish?).
// status: config, module state, bot perms/role position, channels.
// test @user: simulates the trap decision WITHOUT punishing -- shows exactly
// which check would skip/fail (exempt, hierarchy, missing perm).
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder } = require('discord.js');
const { requireMod, hasModRole, botMember } = require('../utils/mod');
const { config } = require('../config');

function needPermFor(action) {
  if (action === 'ban') return PermissionFlagsBits.BanMembers;
  if (action === 'kick') return PermissionFlagsBits.KickMembers;
  return PermissionFlagsBits.ModerateMembers;
}

function permName(action) {
  if (action === 'ban') return 'Ban Members';
  if (action === 'kick') return 'Kick Members';
  return 'Timeout Members';
}

async function statusLines(interaction, client) {
  const lines = [];
  let mod = null;
  try { mod = require('../modules/manager'); } catch {}
  const on = mod ? mod.isEnabled('honeypot') : config.modules.honeypot;
  lines.push(`${on ? '🟢' : '⚪'} Module honeypot: ${on ? 'enabled' : 'DISABLED (MODULE_HONEYPOT / /modules)'}`);
  lines.push(`🎬 Action: \`${config.honeypot.action}\`${config.honeypot.action === 'timeout' ? ` (${config.honeypot.timeoutHours}h)` : ''}`);

  const trapId = config.honeypot.trapChannelId;
  if (!trapId) {
    lines.push('❌ Trap channel: `HONEYPOT_CHANNEL_ID` not set -- nothing to guard');
  } else {
    const ch = await client.channels.fetch(trapId).catch(() => null);
    lines.push(ch ? `✅ Trap channel: <#${trapId}>` : `❌ Trap channel \`${trapId}\` NOT FOUND / no access`);
  }
  const logId = config.honeypot.logChannelId || config.logChannelId;
  if (!logId) {
    lines.push('⚠️ Log channel: not set -- failures are silent');
  } else {
    const ch = await client.channels.fetch(logId).catch(() => null);
    lines.push(ch ? `✅ Log channel: <#${logId}>` : `❌ Log channel \`${logId}\` NOT FOUND -- failures are silent`);
  }

  const bot = await botMember(interaction).catch(() => null);
  if (!bot) {
    lines.push('❌ Cannot resolve bot member -- check intents');
  } else {
    const p = bot.permissions;
    const has = (f) => { try { return !!p?.has?.(f); } catch { return false; } };
    lines.push(`${has(PermissionFlagsBits.ModerateMembers) ? '✅' : '❌'} Bot perm: Timeout Members`);
    lines.push(`${has(PermissionFlagsBits.KickMembers) ? '✅' : '❌'} Bot perm: Kick Members`);
    lines.push(`${has(PermissionFlagsBits.BanMembers) ? '✅' : '❌'} Bot perm: Ban Members`);
    lines.push(`🤖 Bot top role: **${bot.roles?.highest?.name || '?'}** (pos ${bot.roles?.highest?.position ?? '?'}) -- must sit ABOVE punished users`);
    const need = needPermFor(config.honeypot.action);
    if (!has(need)) lines.push(`❌ Configured action needs \`${permName(config.honeypot.action)}\` -- bot lacks it, every punish FAILS`);
  }
  lines.push(config.honeypot.bannerUrl ? '✅ Banner set (posted above warning)' : '⚪ Banner: not set');
  return lines;
}

async function testLines(interaction, client, user) {
  const lines = [`Dry-run for ${user} (\`${user.id}\`) -- nothing will be punished:`];
  const guild = interaction.guild;
  if (!guild) { lines.push('❌ Run this on the server, not in DM'); return lines; }
  let member = null;
  try { member = await guild.members.fetch(user.id); } catch {}
  if (!member) { lines.push('❌ User is not on this server -- trap only hits members'); return lines; }

  // Mirror detector.punish() decision order.
  if (user.bot) {
    lines.push('ℹ️ Bot account: trap DOES act on bots (humans: see exempt check below)');
  } else {
    const { isExempt } = (() => { try { return require('../modules/honeypot/detector'); } catch { return {}; } })();
    if (config.adminIds.includes(user.id)) lines.push('⚪ Would SKIP: bot admin (`ADMIN_DISCORD_IDS`)');
    else if (member && hasModRole(member)) lines.push('⚪ Would SKIP: has mod role (`MOD_ROLE_ID`)');
    else if (member?.permissions?.has?.(PermissionFlagsBits.ManageMessages)) lines.push('⚪ Would SKIP: has Manage Messages (staff)');
    else if (member?.permissions?.has?.(PermissionFlagsBits.ModerateMembers)) lines.push('⚪ Would SKIP: has Timeout Members (staff)');
    else if (typeof isExempt === 'function' && isExempt(member, user.id)) lines.push('⚪ Would SKIP: staff-exempt');
    else lines.push('✅ Not exempt -- would be punished');
  }

  const bot = await botMember(interaction).catch(() => null);
  const need = needPermFor(config.honeypot.action);
  if (!bot) {
    lines.push('❌ Cannot resolve bot member');
  } else {
    const has = (() => { try { return !!bot.permissions?.has?.(need); } catch { return false; } })();
    lines.push(has ? `✅ Bot has \`${permName(config.honeypot.action)}\`` : `❌ Bot LACKS \`${permName(config.honeypot.action)}\` -- punish would FAIL`);
    const bPos = bot.roles?.highest?.position ?? -1;
    const tPos = member.roles?.highest?.position ?? 0;
    lines.push(bPos > tPos
      ? `✅ Hierarchy ok (bot pos ${bPos} > target pos ${tPos})`
      : `❌ Hierarchy BLOCKS: bot pos ${bPos} <= target pos ${tPos} -- move the bot role ABOVE punished roles`);
  }
  let mod = null;
  try { mod = require('../modules/manager'); } catch {}
  const on = mod ? mod.isEnabled('honeypot') : config.modules.honeypot;
  lines.push(on ? '✅ Module enabled' : '❌ Module DISABLED -- enable via `/modules enable honeypot` or `MODULE_HONEYPOT=on`');
  lines.push(config.honeypot.trapChannelId ? `✅ Trap channel set (<#${config.honeypot.trapChannelId}>)` : '❌ `HONEYPOT_CHANNEL_ID` not set');
  return lines;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('honeypot')
    .setDescription('Honeypot trap: status and dry-run test')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('status').setDescription('Config, module state, bot perms/role position'))
    .addSubcommand(s => s.setName('test').setDescription('Dry-run: would this user be punished? (punishes nothing)')
      .addUserOption(o => o.setName('user').setDescription('Who to check').setRequired(true))),
  async execute(interaction, client) {
    if (!await requireMod(interaction)) return;
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      if (sub === 'test') {
        const user = interaction.options.getUser('user', true);
        const lines = await testLines(interaction, client, user);
        const e = new EmbedBuilder().setColor(0xf59e0b).setTitle('🍯 Honeypot dry-run').setTimestamp()
          .setDescription(lines.join('\n').slice(0, 3800));
        await interaction.editReply({ embeds: [e] });
        return;
      }
      const lines = await statusLines(interaction, client);
      const e = new EmbedBuilder().setColor(0x7c3aed).setTitle('🍯 Honeypot status').setTimestamp()
        .setDescription(lines.join('\n').slice(0, 3800));
      await interaction.editReply({ embeds: [e] });
    } catch (err) {
      await interaction.editReply({ content: `❌ Honeypot error: ${String(err.message || err).slice(0, 200)}` }).catch(() => {});
    }
  },
};
