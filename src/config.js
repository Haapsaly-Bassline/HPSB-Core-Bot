require('dotenv').config();

function parseMap(str) {
  // "a:b,c:d" -> [{ key: a, channelId: b }]
  if (!str) return [];
  return str.split(',').map(s => s.trim()).filter(Boolean).map(pair => {
    const idx = pair.lastIndexOf(':');
    if (idx === -1) return null;
    const key = pair.slice(0, idx).trim();
    const channelId = pair.slice(idx + 1).trim();
    return { key, channelId };
  }).filter(x => x && x.key && x.channelId);
}

function parseIds(str) {
  if (!str) return [];
  return str.split(',').map(s => s.trim()).filter(Boolean);
}

const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID,
  guildId: process.env.GUILD_ID,
  modRoleId: process.env.MOD_ROLE_ID,
  logChannelId: process.env.LOG_CHANNEL_ID || '',
  adminIds: parseIds(process.env.ADMIN_DISCORD_IDS),

  // Для будущей OAuth-связки с сайтом (пока не используется ботом напрямую)
  siteAuth: {
    clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
    redirectUri: process.env.DISCORD_REDIRECT_URI || '',
    sessionSecret: process.env.SESSION_SECRET || '',
  },

  modcall: {
    panelChannelId: process.env.MODCALL_CHANNEL_ID || '1342958464355536967',
    staffChannelId: process.env.MODCALL_STAFF_CHANNEL_ID || '',
  },

  automod: {
    floodCount: Number(process.env.AUTOMOD_FLOOD_COUNT || 6),
    floodSecs: Number(process.env.AUTOMOD_FLOOD_SECS || 8),
    capsMinLen: Number(process.env.AUTOMOD_CAPS_MINLEN || 12),
    capsPct: Number(process.env.AUTOMOD_CAPS_PCT || 75),
    links: (process.env.AUTOMOD_LINKS || 'on') === 'on',
    linkWhitelist: (process.env.AUTOMOD_LINK_WHITELIST || 'hpsbassline.club,azura.hpsbassline.club,youtube.com,youtu.be,spotify.com,soundcloud.com,bandcamp.com,audiomack.com,discord.gg,discord.com,instagram.com,tiktok.com').split(',').map(s => s.trim()).filter(Boolean),
    invites: (process.env.AUTOMOD_INVITES || 'on') === 'on',
    badwords: (process.env.AUTOMOD_BADWORDS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
    actionHours: Number(process.env.AUTOMOD_ACTION_HOURS || 1),
  },

  honeypot: {
    trapChannelId: process.env.HONEYPOT_CHANNEL_ID || '1552843652307492935',
    logChannelId: process.env.HONEYPOT_LOG_CHANNEL_ID || '',
    // Публичная ловушка: кто первым пишет в канал — получает наказание.
    // action: timeout (мут) | kick | ban; timeoutHours — длительность мута.
    action: process.env.HONEYPOT_ACTION || 'timeout',
    timeoutHours: Number(process.env.HONEYPOT_TIMEOUT_HOURS || 12),
    // URL баннера для варнинга (залей картинку WARNING в Discord и вставь ссылку). Без него — просто красный эмбед.
    bannerUrl: process.env.HONEYPOT_BANNER_URL || '',
  },

  music: {
    // Spotify Client ID/Secret БЕСПЛАТНЫ (developer.spotify.com), оплата не нужна.
    // Без них spotify-ссылки резолвятся хуже (через текстовый поиск), с ними — точно.
    spotifyClientId: process.env.SPOTIFY_CLIENT_ID || '',
    spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
    // Движок: discord-player (сейчас) | lavalink (на VPS, см. lavalink/README.md).
    // Код lavalink-движка подключается на VPS-этапе, флаг уже заложен.
    engine: process.env.MUSIC_ENGINE || 'discord-player',
    lavalink: {
      host: process.env.LAVALINK_HOST || '127.0.0.1',
      port: Number(process.env.LAVALINK_PORT || 2333),
      password: process.env.LAVALINK_PASSWORD || '',
      secure: (process.env.LAVALINK_SECURE || 'false') === 'true',
    },
  },

  reposter: {
    youtube: parseMap(process.env.YOUTUBE_MAP),
    tiktok: parseMap(process.env.TIKTOK_MAP),
    instagram: parseMap(process.env.INSTAGRAM_MAP),
    pollMinutes: Number(process.env.REPOST_POLL_MINUTES || 10),
    // Бесплатный YouTube Data API v3 ключ (console.cloud.google.com, quota хватит за глаза).
    // Без него: RSS → скрап страницы. С ключом — идеально точно.
    youtubeApiKey: process.env.YT_API_KEY || '',
    // Instagram без подписки: как у других ботов — скрап публичного профиля.
    // Опционально ускорьте/стабилизируйте через cookie своей сессии (см. .env.example).
    instagramSessionId: process.env.IG_SESSIONID || '',
    instagramCsrf: process.env.IG_CSRFTOKEN || '',
    instagramDid: process.env.IG_DID || '',
    instagramGraphToken: process.env.IG_GRAPH_TOKEN || '',
    instagramBusinessId: process.env.IG_BUSINESS_ID || '',
  },

  // HPSB свои сервисы: JSON первичен, RSS — фолбэк
  hpsb: {
    pollMinutes: Number(process.env.HPSB_POLL_MINUTES || process.env.SITE_API_POLL_MINUTES || 5),
    releases: {
      apiUrl: process.env.RELEASES_API_URL || 'https://release.hpsbassline.club/api/releases',
      rssUrl: process.env.RELEASES_RSS_URL || 'https://www.hpsbassline.club/api/feed/releases.xml',
      channelId: process.env.RELEASES_CHANNEL_ID || process.env.SITE_NEWS_CHANNEL_ID || '',
      baseUrl: (process.env.RELEASES_BASE_URL || 'https://release.hpsbassline.club').replace(/\/$/, ''),
      pageBase: (process.env.RELEASES_PAGE_BASE || 'https://hpsbassline.club/releases').replace(/\/$/, ''),
    },
    events: {
      apiUrl: process.env.EVENTS_API_URL || 'https://events.hpsbassline.club/api/events',
      rssUrl: process.env.EVENTS_RSS_URL || 'https://www.hpsbassline.club/api/feed/events.xml',
      channelId: process.env.EVENTS_CHANNEL_ID || process.env.SITE_NEWS_CHANNEL_ID || '',
      pageBase: (process.env.EVENTS_PAGE_BASE || 'https://hpsbassline.club/events').replace(/\/$/, ''),
    },
    posts: {
      apiUrl: process.env.POSTS_API_URL || 'https://www.hpsbassline.club/api/posts',
      channelId: process.env.POSTS_CHANNEL_ID || process.env.SITE_NEWS_CHANNEL_ID || '',
    },
  },

  // Anti-raid: всплеск заходов — новичков в мут. 0 = выкл.
  antiraid: {
    joins: Number(process.env.ANTIRAID_JOINS || 8),
    secs: Number(process.env.ANTIRAID_SECS || 30),
    hours: Number(process.env.ANTIRAID_HOURS || 1),
  },

  // Member Count: ID каналов-счётчиков (создай голосовые, бот будет переименовывать)
  stats: {
    intervalMin: Number(process.env.STATS_INTERVAL_MIN || 15),
    members: process.env.STATS_MEMBERS_CHANNEL_ID || '',
    humans: process.env.STATS_HUMANS_CHANNEL_ID || '',
    bots: process.env.STATS_BOTS_CHANNEL_ID || '',
    boosts: process.env.STATS_BOOSTS_CHANNEL_ID || '',
    membersLabel: process.env.STATS_MEMBERS_LABEL || '👥 Участники',
    humansLabel: process.env.STATS_HUMANS_LABEL || '🧍 Люди',
    botsLabel: process.env.STATS_BOTS_LABEL || '🤖 Боты',
    boostsLabel: process.env.STATS_BOOSTS_LABEL || '💎 Бусты',
  },

  // Автокросспост из announcement-каналов подписчикам (ID через запятую)
  autopublish: parseIds(process.env.AUTOPUBLISH_CHANNEL_IDS),

  // legacy single-feed (осталось для совместимости)
  siteApi: {
    url: process.env.SITE_API_URL || '',
    key: process.env.SITE_API_KEY || '',
    pollMinutes: Number(process.env.SITE_API_POLL_MINUTES || 5),
    channelId: process.env.SITE_NEWS_CHANNEL_ID || '',
  },

  webhook: {
    port: Number(process.env.WEBHOOK_PORT || 3001),
    secret: process.env.WEBHOOK_SECRET || '',
    channelId: process.env.WEBHOOK_NEWS_CHANNEL_ID || '',
  },
};

function validate() {
  const missing = [];
  if (!config.token) missing.push('DISCORD_TOKEN');
  if (!config.clientId) missing.push('CLIENT_ID');
  if (!config.guildId) missing.push('GUILD_ID');
  if (missing.length) {
    console.warn('[config] Missing required env:', missing.join(', '));
  }
}

module.exports = { config, validate };
