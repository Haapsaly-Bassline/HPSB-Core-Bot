// Multistream live state: YouTube + Twitch describe ONE physical stream.
// Second source updates the existing Discord message instead of posting another.
// { youtube: {videoId, url, live, channelId}, twitch: {streamId, url, live}, discord: {channelId, messageId} }
// channelId scopes offline signals: with several YT channels polled, channel B
// going offline must not end channel A's stream message.
function blank() {
  return { youtube: null, twitch: null, discord: null };
}

function fromStored(st) {
  if (!st || typeof st !== 'object') return blank();
  return {
    youtube: st.youtube?.live ? { videoId: st.youtube.videoId || null, url: st.youtube.url || null, live: true, channelId: st.youtube.channelId || null } : null,
    twitch: st.twitch?.live ? { streamId: st.twitch.streamId || null, url: st.twitch.url || null, live: true } : null,
    discord: st.discord?.messageId ? { channelId: st.discord.channelId || null, messageId: st.discord.messageId } : null,
  };
}

function isLive(st) {
  return !!(st?.youtube?.live || st?.twitch?.live);
}

// Returns 'create' | 'update' | 'noop' for an incoming live signal.
// Same videoId re-announced (every live-check tick) is a 'noop': without this
// the LIVE message gets pointlessly re-edited every LIVE_CHECK_MINUTES.
function applyOnline(st, source, ref) {
  if (source === 'youtube') {
    if (st.youtube?.live && st.youtube.videoId && ref.videoId && st.youtube.videoId === ref.videoId) return 'noop';
    st.youtube = { videoId: ref.videoId || null, url: ref.url || null, live: true, channelId: ref.channelId || null };
  } else if (source === 'twitch') {
    if (st.twitch?.live && st.twitch.streamId && ref.streamId && st.twitch.streamId === ref.streamId) return 'noop';
    st.twitch = { streamId: ref.streamId || null, url: ref.url || null, live: true };
  } else return 'noop';
  return st.discord?.messageId ? 'update' : 'create';
}

function applyOffline(st, source, channelId = null) {
  if (source === 'youtube') {
    // Scoped: ignore offline from a channel that doesn't own the live slot.
    if (channelId && st.youtube?.channelId && st.youtube.channelId !== channelId) return 'noop';
    st.youtube = null;
  } else if (source === 'twitch') st.twitch = null;
  else return 'noop';
  if (!isLive(st)) {
    st.discord = null;
    return 'ended';
  }
  return 'update';
}

// Link buttons for the LIVE message. Never fake URLs: only known ones,
// plus configured fallbacks (YOUTUBE_LIVE_URL / TWITCH_URL). Non-http values skipped.
function liveButtons(st, cfg) {
  const out = [];
  const ok = (u) => /^https?:\/\/\S+$/i.test(String(u || ''));
  const yUrl = st.youtube?.url || cfg?.youtubeLiveUrl || '';
  const tUrl = st.twitch?.url || cfg?.twitchUrl || '';
  if (ok(yUrl)) out.push({ label: 'YouTube', url: String(yUrl) });
  if (ok(tUrl)) out.push({ label: 'Twitch', url: String(tUrl) });
  return out;
}

module.exports = { blank, fromStored, isLive, applyOnline, applyOffline, liveButtons };
