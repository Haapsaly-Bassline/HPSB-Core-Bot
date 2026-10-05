// Router: normalized event -> target (media/announcements) -> Discord channel.
// Sources suggest ev.target, router has final say by source/type.
// Channel priority: new ANNOUNCEMENTS_/MEDIA_CHANNEL_ID > legacy mappings.
const MEDIA_SOURCES = new Set(['youtube', 'instagram', 'tiktok']);
const ANNOUNCE_SOURCES = new Set(['hpsb', 'twitch']);

function resolveTarget(ev) {
  if (ev?.target === 'media' || ev?.target === 'announcements') return ev.target;
  const s = String(ev?.source || '').toLowerCase();
  if (MEDIA_SOURCES.has(s)) return 'media';
  if (ANNOUNCE_SOURCES.has(s)) return 'announcements';
  return 'announcements';
}

function resolveChannel(target, cfg) {
  const pub = cfg?.publisher || {};
  if (target === 'media') {
    return pub.mediaChannelId
      || cfg?.reposter?.youtube?.[0]?.channelId
      || '';
  }
  return pub.announcementsChannelId
    || cfg?.hpsb?.releases?.channelId
    || cfg?.hpsb?.events?.channelId
    || cfg?.hpsb?.posts?.channelId
    || cfg?.siteApi?.channelId
    || '';
}

function pingFor(target, cfg) {
  const role = target === 'media'
    ? (cfg?.mediaRoleId || cfg?.announceRoleId || '')
    : (cfg?.announceRoleId || '');
  return role ? `<@&${role}>` : '';
}

module.exports = { resolveTarget, resolveChannel, pingFor, MEDIA_SOURCES, ANNOUNCE_SOURCES };
