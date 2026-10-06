// /partner-post: modal -> Partners channel card (banner + "Find us on" link
// buttons + "Partnership started on <date>" footer). Moderators only.
// Publisher never auto-posts to #partners -- this command is the only writer.
const {
  SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ModalBuilder,
  TextInputBuilder, TextInputStyle, ActionRowBuilder, ChannelType,
  AttachmentBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder,
  MediaGalleryBuilder, MediaGalleryItemBuilder, TextDisplayBuilder, SeparatorBuilder,
} = require('discord.js');
const { requireMod, replyError } = require('../utils/mod');
const { config } = require('../config');

const MODAL_ID = 'partner-post:modal';

function parseLinks(raw, max = 5) {
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
    if (out.length >= max) break;
  }
  return out;
}

// Reference look (RF): ONE Components-V2 container -- full-width media gallery
// banner on top, bold title, tagline, divider, "Find us on:", link buttons,
// divider, small footer. A classic embed can never do this (image capped
// ~400px, no dividers, timestamped footer).
function buildPost({ name, tagline, image, links, started, banner }) {
  const title = `${name} x HPSB (Partnership)`.slice(0, 200);
  const img = (banner && banner.ref)
    || (/^https?:\/\/\S+$/i.test(String(image || '').trim()) ? String(image).trim() : '');
  const date = String(started || '').trim();

  const container = new ContainerBuilder();
  if (img) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(img).setDescription(title.slice(0, 100)),
      ),
    );
  }
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${title}\n${String(tagline || '').slice(0, 1500)}`),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true),
  );
  container.addTextDisplayComponents(
    new TextInputSafe('**Find us on:**'),
  );
  const row = new ActionRowBuilder();
  for (const l of (links || []).slice(0, 5)) {
    if (!/^https?:\/\/\S+$/i.test(l.url || '')) continue;
    row.addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(String(l.label || 'Link').slice(0, 40)).setURL(String(l.url)),
    );
  }
  if (row.components.length) container.addActionRowComponents(row);
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `-# 🤝 Partnership started on ${date ? date.slice(0, 100) : 'soon'}`,
    ),
  );

  const files = banner && banner.file ? [banner.file] : [];
  return {
    data: { flags: [MessageFlags.IsComponentsV2], components: [container] },
    files,
  };
}

// Link buttons are sanitized here (never trust modal text near setURL).
function TextInputSafe(text) {
  return new TextDisplayBuilder().setContent(String(text || '').slice(0, 2000));
}

// Re-host the banner through Discord itself: signed/proxied URLs (VRChat
// CloudFront links, expiring media URLs, hotlink-guarded hosts) often refuse
// Discord's image proxy, so the embed shows no banner. A bot-uploaded
// attachment always renders. Falls back to the plain URL on any failure.
async function fetchBannerAttachment(url) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    let res;
    try {
      res = await fetch(url, { signal: ctl.signal, redirect: 'follow' });
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) return null;
    const ct = String(res.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('image/')) return null;
    const len = Number(res.headers.get('content-length') || 0);
    if (len > 8000000) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > 8000000) return null;
    const ext = ct.includes('png') ? 'png' : ct.includes('gif') ? 'gif' : ct.includes('webp') ? 'webp' : 'jpg';
    const name = `banner.${ext}`;
    return { file: new AttachmentBuilder(buf, { name }), ref: `attachment://${name}` };
  } catch { return null; }
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
    // Ack the modal first: the banner download can take seconds, and modal
    // tokens expire after ~3s (late reply = "interaction failed" on success).
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const banner = await fetchBannerAttachment(image);
    const { data, files } = buildPost({ name, tagline, image, links, started, banner });
    const payload = { ...data };
    if (files.length) payload.files = files;
    const m = await ch.send(payload);
    try {
      if (ch.type === ChannelType.GuildAnnouncement) await m.crosspost().catch(() => {});
    } catch {}
    const how = files.length ? 'banner re-uploaded (always displays)' : 'banner linked by URL (fallback)';
    await interaction.editReply({ content: `✅ Posted in <#${channelId}>: ${m.url}\n_${how}_` });
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
      row('pp-links', 'Links, one per line: Label | URL (max 5)', TextInputStyle.Paragraph, { max: 500, placeholder: 'Roblox | https://…\nWebsite | https://…' }),
      row('pp-started', 'Partnership started on (date text)', TextInputStyle.Short, { max: 60, placeholder: 'january 23, 2026' }),
    );
    await interaction.showModal(modal);
  },
  handleModal,
  parseLinks,
  buildPost,
};
