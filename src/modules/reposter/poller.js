const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const { config } = require('../../config');
const { logger } = require('../../utils/logger');
const store = require('../../utils/store');
const { renderTpl, mediaPing } = require('../../utils/embeds');

const parser = new XMLParser({ ignoreAttributes: false });

function linkBtn(label, url) {
  return new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label.slice(0, 80)).setURL(url);
}

// embed + text with media role ping + link buttons
async function postToChannel(client, channelId, { embed, content, buttons = [] }) {
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch?.isTextBased()) return false;
  const payload = { embeds: [embed] };
  if (content) payload.content = content;
  if (buttons.length) {
    payload.components = [new ActionRowBuilder().addComponents(...buttons.slice(0, 5))];
  }
  const m = await ch.send(payload).catch((e) => {
    logger.warn('[reposter] discord send failed', channelId, e?.message || e);
    return null;
  });
  if (!m) return false;
  // Announcement channels don't push to followers without an explicit publish.
  if (ch.type === ChannelType.GuildAnnouncement) {
    await m.crosspost().catch(() => {});
  }
  return true;
}

function mediaText(tpl, vars) {
  const t = renderTpl(tpl, vars, mediaPing());
  return t || undefined;
}

function ytDateMs(item) {
  const t = item?.date ? new Date(item.date).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

// Same republish semantics as HPSB checks: known items, oldest first.
function ytPickTargets(items, knownSet, { republish = 0 } = {}) {
  if (!(republish > 0)) return null;
  return [...items].reverse()
    .map((item, ix) => ({ item, ix, t: ytDateMs(item) }))
    .filter(x => knownSet.has(x.item.id))
    .sort((a, b) => (a.t - b.t) || (a.ix - b.ix))
    .slice(0, Math.min(republish, 25))
    .map(x => x.item);
}

function skippedByFilter(opts, key) {
  return !!(opts?.sources && !opts.sources.includes(key));
}

const YT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Returns [{ id, title, author }] (up to ~8). Chain:
// 1) YouTube Data API v3 (if free YT_API_KEY set -- most reliable),
// 2) public RSS (no key, but YouTube sometimes blocks by IP),
// 3) scrape /videos page + oEmbed titles (works almost always).
async function fetchLatestYouTube(ytId) {
  const key = config.reposter.youtubeApiKey;
  if (key) {
    try {
      const ch = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
        params: { part: 'contentDetails', id: ytId, key }, timeout: 15000,
      });
      const uploads = ch.data?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (uploads) {
        const pl = await axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
          params: { part: 'snippet,contentDetails', playlistId: uploads, maxResults: 8, key }, timeout: 15000,
        });
        const items = (pl.data?.items || []).map(i => ({
          id: i.contentDetails?.videoId,
          title: i.snippet?.title,
          author: i.snippet?.channelTitle,
          date: i.contentDetails?.videoPublishedAt || i.snippet?.publishedAt || '',
        })).filter(x => x.id);
        if (items.length) return items;
      }
    } catch (e) { logger.warn(`[reposter/yt] api fallback: ${e.message}`); }
  }

  try {
    const { data } = await axios.get(`https://www.youtube.com/feeds/videos.xml?channel_id=${ytId}`, {
      timeout: 15000, headers: { 'User-Agent': YT_UA },
    });
    const feed = parser.parse(data);
    const entries = Array.isArray(feed?.feed?.entry) ? feed.feed.entry : feed?.feed?.entry ? [feed.feed.entry] : [];
    const items = entries.slice(0, 8).map(en => ({
      id: en['yt:videoId'], title: en.title, author: en?.author?.name,
      date: en.published || en.updated || '',
    })).filter(x => x.id);
    if (items.length) return items;
  } catch (e) { logger.warn(`[reposter/yt] rss blocked (${e.message}), trying scrape`); }

  const { data: html } = await axios.get(`https://www.youtube.com/channel/${ytId}/videos`, {
    timeout: 20000, headers: { 'User-Agent': YT_UA, 'Accept-Language': 'en-US,en;q=0.9' },
  }).catch((e) => {
    logger.warn(`[reposter/yt] scrape failed (${e.message}), skipping quietly`);
    return { data: '' };
  });
  const re = new RegExp('"videoId":"([A-Za-z0-9_-]{11})"', 'g');
  const ids = []; const seen = new Set(); let m;
  while ((m = re.exec(String(html))) && ids.length < 12) {
    if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); }
  }
  return ids.map(id => ({ id }));
}

async function ytTitleFallback(item) {
  if (item.title) return item;
  try {
    const { data } = await axios.get('https://www.youtube.com/oembed', {
      params: { url: `https://www.youtube.com/watch?v=${item.id}`, format: 'json' }, timeout: 15000,
    });
    return { ...item, title: data.title, author: data.author_name };
  } catch { return item; }
}

async function postVideo(client, channelId, { id, title, author }) {
  const link = `https://www.youtube.com/watch?v=${id}`;
  const embed = new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle(`▶️ ${(title || 'YouTube').slice(0, 250)}`)
    .setURL(link)
    .setDescription(`${author ? `by **${author}**\n` : ''}${link}`.slice(0, 2000))
    .setImage(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`)
    .setFooter({ text: 'Haapsaly Bassline • YouTube' })
    .setTimestamp();
  const text = mediaText(config.reposter.templates.youtube, { author: author || 'HPSB', title: title || '', link });
  return postToChannel(client, channelId, { embed, content: text, buttons: [linkBtn('▶️ Watch on YouTube', link)] });
}

// Publish single video with dedup -- for poller and PubSubHubbub.
// channelId: YT channel (topic). Returns true if actually posted.
async function publishYouTubeVideo(client, { videoId, title, author, channelId }) {
  const vid = String(videoId || '').trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(vid)) { logger.warn('[reposter/yt] bad videoId, skipped'); return false; }
  const entry = config.reposter.youtube.find(x => x.key === channelId);
  if (!entry) { logger.warn('[reposter/yt] unknown channel, skipped'); return false; }
  return store.exclusive(async () => {
    const state = store.load();
    let known = state.youtube[entry.key];
    if (typeof known === 'string') known = [known];
    if (!Array.isArray(known)) known = [];
    if (known.includes(vid)) return false;
    const ok = await postVideo(client, entry.channelId, { id: vid, title, author });
    if (ok) {
      state.youtube[entry.key] = [...new Set([...known, vid])].slice(-20);
      store.save(state);
      logger.info(`[reposter/yt] new ${vid}`);
    }
    return ok;
  });
}

async function checkYouTube(client, state, opts = {}) {
  if (skippedByFilter(opts, 'youtube')) return { found: 0, posted: 0, filtered: true };
  let found = 0, posted = 0;
  for (const { key: ytId, channelId } of config.reposter.youtube) {
    try {
      const items = await fetchLatestYouTube(ytId);
      found += items.length;
      if (!items.length) continue; // quiet miss (blocked/empty) -- visible as found:0 in /sync
      // known -- array of recent IDs (scrape order unstable, compare by set)
      let known = state.youtube[ytId];
      if (typeof known === 'string') known = [known];
      if (!Array.isArray(known)) known = [];
      if (!known.length) {
        state.youtube[ytId] = items.map(i => i.id); // first run -- only remember
        continue;
      }
      const knownSet = new Set(known);
      const republish = opts.republish || 0;
      const fresh = republish > 0
        ? ytPickTargets(items, knownSet, { republish })
        : items.filter(i => !knownSet.has(i.id)).slice(0, 3);
      const withTitles = await Promise.all(fresh.map(ytTitleFallback));
      for (const item of withTitles) {
        if (await postVideo(client, channelId, { id: item.id, title: item.title, author: item.author })) {
          knownSet.add(item.id);
          posted++;
          logger.info(`[reposter/yt] new ${item.id}`);
        }
      }
      state.youtube[ytId] = [...knownSet].slice(-20);
    } catch (e) { logger.warn(`[reposter/yt] ${ytId}:`, e.message); }
  }
  return { found, posted };
}

async function checkTikTok(client, state, opts = {}) {
  if (skippedByFilter(opts, 'tiktok')) return { found: 0, posted: 0, filtered: true };
  let found = 0, posted = 0;
  for (const { key: username, channelId } of config.reposter.tiktok) {
    try {
      const uname = username.replace(/^@/, '');
      // Free TikWM without key, may rate-limit
      const { data } = await axios.get(`https://www.tikwm.com/api/user/posts?unique_id=${encodeURIComponent(uname)}&count=3`, { timeout: 15000 });
      const videos = data?.data?.videos || data?.data?.posts || [];
      found += videos.length;
      if (!videos.length) continue;
      // Post EVERYTHING new oldest-first (not just videos[0]): with count=3 and a
      // poll gap, middle videos would otherwise be skipped forever.
      let known = state.tiktok[uname];
      if (!Array.isArray(known)) known = known ? [String(known)] : [];
      const knownSet = new Set(known);
      if (!knownSet.size) {
        state.tiktok[uname] = videos.map(v => String(v.video_id || v.id || v.aweme_id || '')).filter(Boolean).slice(0, 10);
        continue; // first run -- remember
      }
      const republish = opts.republish || 0;
      const norm = videos
        .map((v, ix) => ({
          vid: String(v.video_id || v.id || v.aweme_id || ''),
          title: String(v.title ?? v.desc ?? 'TikTok').slice(0, 250),
          t: Number(v.create_time) > 0 ? Number(v.create_time) * 1000 : 0,
          ix,
        }))
        .filter(v => v.vid);
      let fresh;
      if (republish > 0) {
        fresh = [...norm].reverse()
          .filter(v => knownSet.has(v.vid))
          .sort((a, b) => (a.t - b.t) || (a.ix - b.ix))
          .slice(0, Math.min(republish, 25));
      } else {
        fresh = norm.filter(v => !knownSet.has(v.vid)).reverse().slice(0, 3);
      }
      for (const item of fresh) {
        const link = `https://www.tiktok.com/@${uname}/video/${item.vid}`;
        const text = mediaText(config.reposter.templates.tiktok, { user: uname, title: item.title, link });
        if (await postToChannel(client, channelId, { embed: new EmbedBuilder()
          .setColor(0x1a1a1a).setTitle(`🎵 ${item.title}`)
          .setURL(link).setDescription(`${link}`.slice(0, 2000))
          .setFooter({ text: `TikTok • @${uname}` })
          .setTimestamp(), content: text, buttons: [linkBtn('🎵 Open TikTok', link)] })) {
          knownSet.add(item.vid);
          posted++;
        }
      }
      state.tiktok[uname] = [...knownSet].slice(-10);
    } catch (e) { logger.warn(`[reposter/tt] ${username}:`, e.message); }
  }
  return { found, posted };
}

let timer = null;
let running = false;
const ZERO = { found: 0, posted: 0 };

async function runReposterOnce(client, opts = {}) {
  if (running) { logger.warn('[reposter] previous run still active, skipping'); return { skipped: true }; }
  running = true;
  try {
    return await store.exclusive(async () => {
      const state = store.load();
      // Instagram goes via Make webhook, scraper removed.
      const out = { youtube: { ...ZERO }, tiktok: { ...ZERO } };
      out.youtube = await checkYouTube(client, state, opts);
      out.tiktok = await checkTikTok(client, state, opts);
      store.save(state);
      return out;
    });
  } finally {
    running = false;
  }
}

function pollMinutes() {
  const mins = Number(config.reposter.pollMinutes);
  return Number.isFinite(mins) ? Math.max(2, mins) : 10;
}

function startReposter(client) {
  const mins = pollMinutes();
  const run = () => runReposterOnce(client);
  run().catch(e => logger.warn('[reposter]', e.message));
  if (timer) clearInterval(timer);
  timer = setInterval(() => run().catch(e => logger.warn('[reposter]', e.message)), mins * 60 * 1000);
  timer.unref?.();
  logger.info(`[reposter] polling every ${mins}m (yt:${config.reposter.youtube.length} tt:${config.reposter.tiktok.length})`);
}

module.exports = { startReposter, runReposterOnce, publishYouTubeVideo, ytPickTargets, skippedByFilter };
