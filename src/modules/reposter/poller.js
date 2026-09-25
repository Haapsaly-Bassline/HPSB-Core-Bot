const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const { EmbedBuilder } = require('discord.js');
const { config } = require('../../config');
const { logger } = require('../../utils/logger');
const store = require('../../utils/store');

const parser = new XMLParser({ ignoreAttributes: false });

async function postToChannel(client, channelId, embed) {
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch?.isTextBased()) return false;
  const ok = await ch.send({ embeds: [embed] }).then(() => true).catch(() => false);
  return ok;
}

const YT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Возвращает [{ id, title, author }] (до ~8 шт). Цепочка:
// 1) YouTube Data API v3 (если задан бесплатный YT_API_KEY — самый надёжный),
// 2) публичный RSS (без ключа, но YouTube иногда режет по IP),
// 3) скрап страницы /videos + oEmbed-названия (работает почти всегда).
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
    })).filter(x => x.id);
    if (items.length) return items;
  } catch (e) { logger.warn(`[reposter/yt] rss blocked (${e.message}), пробую скрап`); }

  const { data: html } = await axios.get(`https://www.youtube.com/channel/${ytId}/videos`, {
    timeout: 20000, headers: { 'User-Agent': YT_UA, 'Accept-Language': 'en-US,en;q=0.9' },
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

async function checkYouTube(client, state) {
  let found = 0, posted = 0;
  for (const { key: ytId, channelId } of config.reposter.youtube) {
    try {
      const items = await fetchLatestYouTube(ytId);
      found += items.length;
      if (!items.length) { logger.warn(`[reposter/yt] ${ytId}: пусто везде`); continue; }
      // known — массив последних ID (порядок скрапа нестабилен, сравниваем по множеству)
      let known = state.youtube[ytId];
      if (typeof known === 'string') known = [known];
      if (!Array.isArray(known)) known = [];
      if (!known.length) {
        state.youtube[ytId] = items.map(i => i.id); // первый запуск — только запоминаем
        continue;
      }
      const knownSet = new Set(known);
      const fresh = items.filter(i => !knownSet.has(i.id)).slice(0, 3);
      for (const raw of fresh) {
        const item = await ytTitleFallback(raw);
        const link = `https://www.youtube.com/watch?v=${item.id}`;
        const embed = new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle(`▶️ Новое видео: ${(item.title || 'YouTube').slice(0, 250)}`)
          .setURL(link)
          .setDescription(`${item.author || ''}\n${link}`.slice(0, 2000))
          .setImage(`https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`)
          .setTimestamp();
        if (await postToChannel(client, channelId, embed)) {
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

async function checkTikTok(client, state) {
  let found = 0, posted = 0;
  for (const { key: username, channelId } of config.reposter.tiktok) {
    try {
      const uname = username.replace(/^@/, '');
      // Бесплатный TikWM без ключа, может rate-limit'ить
      const { data } = await axios.get(`https://www.tikwm.com/api/user/posts?unique_id=${encodeURIComponent(uname)}&count=3`, { timeout: 15000 });
      const videos = data?.data?.videos || data?.data?.posts || [];
      found += videos.length;
      if (!videos.length) continue;
      const latest = videos[0];
      const vid = String(latest.video_id || latest.id || latest.aweme_id || '');
      if (!vid) continue;
      const prev = state.tiktok[uname];
      if (prev === vid) continue;
      if (!prev) { state.tiktok[uname] = vid; continue; } // первый запуск — запоминаем
      const link = `https://www.tiktok.com/@${uname}/video/${vid}`;
      if (await postToChannel(client, channelId, new EmbedBuilder()
        .setColor(0x000000).setTitle(`🎵 Новый TikTok @${uname}`)
        .setURL(link).setDescription(`${latest.title || latest.desc || ''}\n${link}`.slice(0, 2000))
        .setTimestamp())) {
        state.tiktok[uname] = vid;
        posted++;
      }
    } catch (e) { logger.warn(`[reposter/tt] ${username}:`, e.message); }
  }
  return { found, posted };
}

async function checkInstagram(client, state) {
  const { fetchLatestPost } = require('./instagram');
  let found = 0, posted = 0;
  for (const { key: username, channelId } of config.reposter.instagram) {
    try {
      const latest = await fetchLatestPost(username);
      if (!latest?.id) { logger.warn(`[reposter/ig] ${username}: empty (все методы мимо, см. IG_SESSIONID)`); continue; }
      found++;
      const prev = state.instagram[username];
      if (prev === latest.id) continue;
      if (!prev) { state.instagram[username] = latest.id; continue; } // первый запуск — запоминаем
      const e = new EmbedBuilder()
        .setColor(0xe1306c).setTitle(`📸 Новый пост @${String(username).replace(/^@/, '')}`)
        .setURL(latest.link || undefined)
        .setDescription(`${(latest.caption || '').slice(0, 1500)}\n${latest.link || ''}`.slice(0, 2000))
        .setFooter({ text: `Instagram • via ${latest.via}` })
        .setTimestamp(latest.timestamp ? new Date(latest.timestamp * (latest.timestamp < 1e12 ? 1000 : 1)) : new Date());
      if (latest.image) e.setImage(latest.image);
      if (await postToChannel(client, channelId, e)) {
        state.instagram[username] = latest.id;
        posted++;
        logger.info(`[reposter/ig] new ${username} (${latest.via})`);
      }
    } catch (e) { logger.warn(`[reposter/ig] ${username}:`, e.message); }
  }
  return { found, posted };
}

let timer = null;
let running = false;
const ZERO = { found: 0, posted: 0 };

async function runReposterOnce(client) {
  if (running) { logger.warn('[reposter] previous run still active, skipping'); return null; }
  running = true;
  try {
    const state = store.load();
    const out = { youtube: { ...ZERO }, tiktok: { ...ZERO }, instagram: { ...ZERO } };
    out.youtube = await checkYouTube(client, state);
    out.tiktok = await checkTikTok(client, state);
    out.instagram = await checkInstagram(client, state);
    store.save(state);
    return out;
  } finally {
    running = false;
  }
}

function startReposter(client) {
  const mins = Math.max(2, config.reposter.pollMinutes || 10);
  const run = () => runReposterOnce(client);
  run().catch(e => logger.warn('[reposter]', e.message));
  if (timer) clearInterval(timer);
  timer = setInterval(() => run().catch(e => logger.warn('[reposter]', e.message)), mins * 60 * 1000);
  timer.unref?.();
  logger.info(`[reposter] polling every ${mins}m (yt:${config.reposter.youtube.length} tt:${config.reposter.tiktok.length} ig:${config.reposter.instagram.length})`);
}

module.exports = { startReposter, runReposterOnce };
