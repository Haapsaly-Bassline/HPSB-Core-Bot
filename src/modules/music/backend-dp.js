// DiscordPlayer-бэкенд MusicService. Поведение = текущее (проверено типами и продом).
const { QueryType, Track } = require('discord-player');
const axios = require('axios');
const { trackMs, fmtMs, currentProgress, etaMs, queueTotalMs } = require('../../utils/music');

const DIRECT_RE = /\.(mp3|ogg|oga|wav|m4a|flac|aac|opus|m3u8|pls)(\?|$)|azura\.hpsbassline\.club\/listen/i;

function getQueue(client, guildId) {
  return client.player.nodes.get(guildId) || null;
}

function viewOf(track, requester) {
  if (!track) return null;
  const ms = trackMs(track);
  return {
    title: track.title || 'Unknown',
    url: /^https?:\/\//i.test(track.url || '') ? track.url : '',
    author: track.author || '',
    thumbnail: track.thumbnail || '',
    durationMs: ms,
    durationLabel: ms > 0 ? fmtMs(ms) : String(track.duration || 'LIVE'),
    requesterTag: requester?.tag || track.requestedBy?.tag || null,
    isLive: ms <= 0,
  };
}

async function play(client, voiceChannel, query, { requester, textChannel, engine, radioLabel } = {}) {
  const meta = { channel: textChannel, requester, radioLabel: radioLabel || null };

  // --- Bandcamp-страницы: свой резолвер ---
  if (/bandcamp\.com/i.test(query) && !DIRECT_RE.test(query)) {
    const { resolveBandcamp } = require('./bandcamp');
    const bc = await resolveBandcamp(query);
    if (!bc) throw new Error('Bandcamp: no streams on page');
    const tracks = bc.tracks.map(t => {
      const tr = new Track(client.player, {
        title: t.title, author: bc.artist || 'Bandcamp', url: query,
        duration: t.durationMs > 0 ? fmtMs(t.durationMs) : 'LIVE',
        thumbnail: bc.artwork || '', requestedBy: requester,
        source: 'arbitrary', queryType: QueryType.ARBITRARY,
      });
      tr.raw.engine = t.stream;
      return tr;
    });
    await client.player.play(voiceChannel, tracks[0], {
      nodeOptions: { metadata: { ...meta } }, requestedBy: requester,
    });
    const queue = getQueue(client, voiceChannel.guild.id);
    if (tracks.length > 1 && queue) queue.addTrack(tracks.slice(1));
    const first = viewOf(tracks[0], requester);
    return {
      kind: tracks.length === 1 ? 'track' : 'bandcamp',
      track: first, position: tracks.length === 1 ? '▶ сейчас' : `${tracks.length} (альбом)`,
      nextTitle: tracks[1]?.title || null, waitMs: 0,
      album: tracks.length > 1 ? { title: bc.title, artist: bc.artist, count: tracks.length, tracks: tracks.map(t => t.title) } : null,
    };
  }

  if (/audiomack\.com/i.test(query) && !DIRECT_RE.test(query)) {
    throw new Error('Audiomack: need direct mp3/m3u8 link or YT/SC mirror');
  }

  const eng = engine || (DIRECT_RE.test(query) ? QueryType.ARBITRARY : QueryType.AUTO);
  const before = getQueue(client, voiceChannel.guild.id);
  const waitMs = before ? etaMs(before) : 0;

  try {
    return await doPlay(client, voiceChannel, query, meta, requester, eng, waitMs);
  } catch (e) {
    const msg = String(e.message || e);
    // SoundCloud-URL не резолвится с части IP — фолбэк через oEmbed-название в поиск SC
    if (/soundcloud\.com|on\.soundcloud/i.test(query) && /no results/i.test(msg)) {
      const { data } = await axios.get('https://soundcloud.com/oembed', {
        params: { url: query, format: 'json' }, timeout: 15000,
      }).catch(() => ({ data: null }));
      const title = `${data?.author_name || ''} ${data?.title || ''}`.trim();
      if (!title) throw e;
      return { ...(await doPlay(client, voiceChannel, title, meta, requester, QueryType.SOUNDCLOUD_SEARCH, waitMs)), viaFallback: title };
    }
    throw e;
  }
}

async function doPlay(client, voiceChannel, query, meta, requester, eng, waitMs) {
  const res = await client.player.play(voiceChannel, query, {
    nodeOptions: { metadata: { ...meta } },
    requestedBy: requester,
    searchEngine: eng,
  });
  const { track, queue, searchResult } = res;
  if (searchResult?.hasPlaylist?.()) {
    const pl = searchResult.playlist;
    return {
      kind: 'playlist', track: viewOf(track, requester),
      playlist: { title: pl?.title || 'playlist', author: pl?.author || '', url: pl?.url || '', count: queue?.tracks?.size ?? pl?.tracks?.length ?? '?' },
      waitMs,
    };
  }
  const upcoming = queue?.tracks?.size ?? null;
  return {
    kind: 'track',
    track: viewOf(track, requester),
    position: upcoming === 0 ? '▶ сейчас' : upcoming,
    nextTitle: upcoming > 0 ? queue.tracks.data[0]?.title : null,
    waitMs,
  };
}

function skip(client, guildId) { const q = getQueue(client, guildId); if (!q?.isPlaying()) return false; q.node.skip(); return true; }
function stop(client, guildId) { const q = getQueue(client, guildId); if (!q) return false; q.delete(); return true; }
function pause(client, guildId, on = true) { const q = getQueue(client, guildId); if (!q) return false; q.node.setPaused(on !== false); return true; }
function seek(client, guildId, ms) { const q = getQueue(client, guildId); if (!q?.currentTrack) return Promise.resolve(false); return q.node.seek(ms).then(() => true).catch(() => false); }
function volume(client, guildId, vol) { const q = getQueue(client, guildId); if (!q) return false; try { q.node.setVolume(vol); return true; } catch { return false; } }
function loop(client, guildId, mode) { const q = getQueue(client, guildId); if (!q) return false; q.setRepeatMode(mode); return true; }
function shuffle(client, guildId) { const q = getQueue(client, guildId); if (!q?.isPlaying() || q.tracks.size === 0) return false; q.tracks.shuffle(); return true; }
function clear(client, guildId) { const q = getQueue(client, guildId); if (!q) return false; q.tracks.clear(); return true; }
function remove(client, guildId, idx) {
  const q = getQueue(client, guildId);
  if (!q || idx < 0 || idx >= q.tracks.size) return null;
  const track = q.tracks.at(idx) || q.tracks.data[idx];
  try { const r = q.node.remove(track); return r ? viewOf(track) : null; } catch { return null; }
}
function move(client, guildId, from, to) {
  const q = getQueue(client, guildId);
  if (!q || from < 0 || from >= q.tracks.size || to < 0 || to >= q.tracks.size) return false;
  try { q.node.move(q.tracks.at(from) || q.tracks.data[from], to); return true; } catch { return false; }
}
function prev(client, guildId) {
  const q = getQueue(client, guildId);
  if (!q) return Promise.resolve(false);
  try { return Promise.resolve(q.history.previous()).then(() => true).catch(() => false); }
  catch { return Promise.resolve(false); }
}

function queueView(client, guildId) {
  const q = getQueue(client, guildId);
  if (!q || (!q.currentTrack && q.tracks.size === 0)) return null;
  return {
    current: viewOf(q.currentTrack),
    upcoming: q.tracks.data.slice(0, 15).map((t, i) => ({ n: i + 1, ...viewOf(t) })),
    size: q.tracks.size,
    totalMs: queueTotalMs(q),
    repeatMode: q.repeatMode ?? 0,
    paused: !!q.node?.isPaused?.(),
  };
}

function npSnapshot(client, guildId) {
  const q = getQueue(client, guildId);
  if (!q?.currentTrack) return null;
  const { currentMs, totalMs } = currentProgress(q, q.currentTrack);
  const radioLabel = q.metadata?.radioLabel || null;
  const track = viewOf(q.currentTrack, q.metadata?.requester || q.currentTrack.requestedBy);
  if (radioLabel) track.title = `📻 ${radioLabel}`;
  return {
    track, positionMs: currentMs, durationMs: totalMs,
    repeatMode: q.repeatMode ?? 0, paused: !!q.node?.isPaused?.(), size: q.tracks.size, radioLabel,
  };
}

module.exports = { play, skip, stop, pause, seek, volume, loop, shuffle, clear, remove, move, prev, queueView, npSnapshot,
  voiceChannelId: (client, guildId) => getQueue(client, guildId)?.channel?.id || null,
};
