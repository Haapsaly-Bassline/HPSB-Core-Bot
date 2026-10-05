// /partner-post: modal -> Partners channel card (banner + "Find us on" link
// buttons + "Partnership started on <date>" footer). Moderators only.
// Publisher never auto-posts to #partners -- this command is the only writer.
const {
  SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ModalBuilder,
  TextInputBuilder, TextInputStyle, EmbedBuilder, ActionRowBuilder, ChannelType,
} = require('discord.js');
const { requireMod, replyError } = require('../utils/mod');
const { config } = require('../config');
const { linkButtonRows } = require('../utils/embeds');

const MODAL_ID = 'partner-post:modal';

function parseLinks(raw) {
  const out = [];
  for (const line of String(raw || '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let label = '';
    let url = '';
    const pipe = t.indexOf('|');
    if (pipe !== -1) {
      label = t.slice(0, pipe).trim();
      url = t.slice(pipe + 1).trim();
    } else {
      const m = t.match(/(https?:\/\/\S+)/);
      if (!m) continue;
      url = m[1];
      label = t.replace(url, '').trim() || url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
    }
    if (!/^https?:\/\/\S+$/i.test(url)) continue;
    out.push({ label: label.slice(0, 40) || 'Link', url });
    if (out.length >= 4) break;
  }
  return out;
}

function buildPost({ name, tagline, image, links, started }) {
  const e = new EmbedBuilder()
    .setColor(0xeab308)
    .setTitle(`${name} x HPSB (Partnership)`.slice(0, 250))
    .setDescription(`${tagline}\n\n**Find us on:**`.slice(0, 3800))
    .setImage(image)
    .setTimestamp();
  const date = String(started || '').trim();
  e.setFooter({ text: date ? `🤝 Partnership started on ${date.slice(0, 100)}` : '🤝 Partnership • Haapsaly Bassline' });
  return { embed: e, components: linkButtonRows(links) };
}

async function handleModal(interaction, client) {
  if (!await requireMod(interaction)) return;
  const channelId = config.publisher.partnersChannelId;
  if (!channelId) {
    await interaction.reply({ content: '❌ `PARTNERS_CHANNEL_ID` is not set in `.env` -- nowhere to post.', flags: MessageFlags.Ephemeral });
    return;
  }
  const name = interaction.fields.getTextInputValue('pp-name').trim();
  const tagline = interaction.fields.getTextInputValue('pp-tagline').trim();
  const image = interaction.fields.getTextInputValue('pp-image').trim();
  const linksRaw = interaction.fields.getTextInputValue('pp-links');
  const started = interaction.fields.getTextInputValue('pp-started').trim();
  if (!/^https?:\/\/\S+$/i.test(image)) {
    await interaction.reply({ content: '❌ Banner must be an `https://` image URL.', flags: MessageFlags.Ephemeral });
    return;
  }
  const links = parseLinks(linksRaw);
  if (!links.length) {
    await interaction.reply({ content: '❌ Add at least one link line: `Label | https://…`.', flags: MessageFlags.Ephemeral });
    return;
  }
  try {
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch?.isTextBased()) {
      await interaction.reply({ content: '❌ Partners channel not found / not text.', flags: MessageFlags.Ephemeral });
      return;
    }
    const { embed, components } = buildPost({ name, tagline, image, links, started });
    const payload = { embeds: [embed] };
    if (components.length) payload.components = components;
    const m = await ch.send(payload);
    try {
      if (ch.type === ChannelType.GuildAnnouncement) await m.crosspost().catch(() => {});
    } catch {}
    await interaction.reply({ content: `✅ Posted in <#${channelId}>: ${m.url}`, flags: MessageFlags.Ephemeral });
  } catch (err) {
    await replyError(interaction, `❌ Post failed: ${String(err.message || err).slice(0, 200)}`);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('partner-post')
    .setDescription('Create a Partners channel post (banner + links + start date)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!await requireMod(interaction)) return;
    if (!config.publisher.partnersChannelId) {
      await interaction.reply({ content: '❌ `PARTNERS_CHANNEL_ID` is not set in `.env` -- nowhere to post.', flags: MessageFlags.Ephemeral });
      return;
    }
    const modal = new ModalBuilder().setCustomId(MODAL_ID).setTitle('New Partner Post');
    const row = (id, label, style, { required = true, max = 200, placeholder = '' } = {}) =>
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style)
          .setRequired(required).setMaxLength(max).setPlaceholder(placeholder).setValue(''),
      );
    modal.addComponents(
      row('pp-name', 'Partner name', TextInputStyle.Short, { max: 80, placeholder: 'Hearkken' }),
      row('pp-tagline', 'Tagline (1-2 lines)', TextInputStyle.Paragraph, { max: 500, placeholder: 'Creating and recreating the best stages around the globe' }),
      row('pp-image', 'Banner image URL (https://…)', TextInputStyle.Short, { max: 400, placeholder: 'https://…' }),
      row('pp-links', 'Links: one per line as  Label | https://…  (max 4)', TextInputStyle.Paragraph, { max: 500, placeholder: 'Roblox | https://…\nWebsite | https://…' }),
      row('pp-started', 'Partnership started on (date text)', TextInputStyle.Short, { max: 60, placeholder: 'january 23, 2026' }),
    );
    await interaction.showModal(modal);
  },
  handleModal,
  parseLinks,
  buildPost,
};
