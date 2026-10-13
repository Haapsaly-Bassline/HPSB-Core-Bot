// 🔖 Save button on media posts: readers DM themselves the link.
// Stateless by design -- the URL is read back out of the message
// (embed url/title-link/description, link buttons), so no per-post storage
// that could rot across restarts.
const { MessageFlags } = require('discord.js');

const URL_RE = /https?:\/\/[^\s<>()]+/gi;

// Collect candidate URLs in priority order: embed canonical URL, markdown
// links in title/description, link-button URLs.
function extractPostUrl(message) {
  const found = [];
  const push = (u) => { if (u && !found.includes(u)) found.push(u); };
  for (const e of message?.embeds || []) {
    const d = typeof e.toJSON === 'function' ? e.toJSON() : e;
    if (d.url) push(d.url);
    for (const t of [d.title, d.description]) {
      for (const m of String(t || '').match(URL_RE) || []) push(m);
    }
  }
  for (const row of message?.components || []) {
    for (const b of row.components || []) {
      if (b.url) push(b.url);
    }
  }
  // Prefer watch/post links over thumbnails/avatars.
  return found.sort((a, b) => score(b) - score(a))[0] || '';
}

function score(u) {
  const s = String(u || '');
  if (/youtube\.com\/watch|youtu\.be\/|tiktok\.com\/@.*\/video|instagram\.com\/(p|reel)/i.test(s)) return 10;
  if (/ytimg\.com|cdn\.discord|discordapp/i.test(s)) return -10;
  if (/^https?:\/\//i.test(s)) return 1;
  return 0;
}

async function handleSaveButton(interaction) {
  const url = extractPostUrl(interaction.message);
  if (!url) {
    await interaction.reply({ content: '❌ Nothing saveable in this post.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }
  try {
    await interaction.user.send(`🔖 Saved from ${interaction.guild?.name || 'HPSB'}:\n${url}`);
    await interaction.reply({ content: '✅ Sent to your DMs.', flags: MessageFlags.Ephemeral }).catch(() => {});
  } catch {
    await interaction.reply({ content: '❌ Could not DM you — open your DMs and try again.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  return true;
}

module.exports = { extractPostUrl, handleSaveButton };
