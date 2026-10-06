require('dotenv').config();

// ============================================================================
// Типы параметров .env
// ----------------------------------------------------------------------------
// string       — любая строка (токен, URL, шаблон). Пусто '' = выключено.
// secret       — string, но секрет (никому не показывать, не коммитить).
// snowflake-id — string из цифр (ID Discord: сервер/канал/роль). Пусто = выкл.
// boolean      — on/true/1/yes/enable  = вкл; off/false/0/no/disable = выкл.
//                Пусто = значение по умолчанию (указано в .env.example).
// integer      — целое число. Пусто/мусор = значение по умолчанию.
// list         — string[] через запятую: "a,b,c". Пусто = [].
// map          — пары "ключ:значение" через запятую: "YT_ID:DISCORD_ID,...".
//                Пусто = [].
// url          — string с http(s)://. Проверяется только наличие, не формат.
// template     — string с плейсхолдерами {role} {author} {user} {title} {link} {count}.
// ============================================================================

/**
 * @typedef {'timeout'|'kick'|'ban'} HoneypotAction
 * @typedef {{ key: string, channelId: string }} ReposterBinding
 * @typedef {Object} BotConfig полный типизированный конфиг (см. объект config ниже).
 */

// --- базовые парсеры ---

/** string: вернёт def, если переменная пустая/отсутствует. */
function str(name, def = '') {
  const v = process.env[name];
  if (v === undefined || v === null) return def;
  const s = String(v).trim();
  return s === '' ? def : s;
}

/** secret: то же что string, просто помечает что значение секретное. */
function secret(name, def = '') {
  return str(name, def);
}

/** snowflake-id: ID Discord, '' = не настроено (фича выключена). */
function id(name, def = '') {
  return str(name, def);
}

/** url: строка-URL, '' = не настроено. Слэш в конце убирается при needTrimSlash. */
function url(name, def = '', needTrimSlash = false) {
  const s = str(name, def);
  return needTrimSlash ? s.replace(/\/$/, '') : s;
}

/**
 * boolean: on/true/1/yes/enable = true; off/false/0/no/disable = false.
 * Пусто/мусор = def.
 */
function bool(name, def = true) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return def;
  const v = String(raw).trim().toLowerCase();
  if (['on', 'true', '1', 'yes', 'enable', 'enabled'].includes(v)) return true;
  if (['off', 'false', '0', 'no', 'disable', 'disabled'].includes(v)) return false;
  return def;
}

/** integer: целое число, при пусто/NaN = def. */
function int(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return def;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

/** list: "a, b, c" -> string[]. Пусто = []. */
function list(name, def = []) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return [...def];
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * map: "key:channelId,key2:channelId2" -> ReposterBinding[].
 * Делит по ПОСЛЕДНЕМУ двоеточию. Пусто = [].
 */
function envMap(name) {
  const raw = process.env[name];
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.lastIndexOf(':');
      if (idx === -1) return null;
      const key = pair.slice(0, idx).trim();
      const channelId = pair.slice(idx + 1).trim();
      return key && channelId ? { key, channelId } : null;
    })
    .filter(Boolean);
}

/** Совместимость: старое имя парсера свитчей. */
function parseSwitch(strVal, defaultValue = true) {
  if (strVal === undefined || strVal === null || String(strVal).trim() === '') return defaultValue;
  const v = String(strVal).trim().toLowerCase();
  if (['on', 'true', '1', 'yes', 'enable', 'enabled'].includes(v)) return true;
  if (['off', 'false', '0', 'no', 'disable', 'disabled'].includes(v)) return false;
  return defaultValue;
}

/** honeypot action: только timeout|kick|ban, иначе def. */
function honeypotAction(name, def = 'timeout') {
  const v = str(name, def).toLowerCase();
  return ['timeout', 'kick', 'ban'].includes(v) ? v : def;
}

// --- конфиг ---

/** @type {BotConfig} */
const config = {
  // Discord core (обязательно). string/secret/snowflake-id.
  token: secret('DISCORD_TOKEN', ''), // secret, обязательно
  clientId: id('CLIENT_ID', '') || id('DISCORD_CLIENT_ID', ''), // snowflake-id, обязательно
  guildId: id('GUILD_ID', ''), // snowflake-id, обязательно
  modRoleId: id('MOD_ROLE_ID', ''), // snowflake-id
  logChannelId: id('LOG_CHANNEL_ID', ''), // snowflake-id, '' = без логов
  adminIds: list('ADMIN_DISCORD_IDS'), // list<snowflake-id>, [] = нет админов

  // Модули on/off. boolean, пусто = true (включено).
  modules: {
    music: bool('MODULE_MUSIC', true),
    publisher: bool('MODULE_PUBLISHER', true),
    automod: bool('MODULE_AUTOMOD', true),
    honeypot: bool('MODULE_HONEYPOT', true),
    modcall: bool('MODULE_MODCALL', true),
    stats: bool('MODULE_STATS', true),
    private: bool('MODULE_PRIVATE', true),
  },

  // OAuth сайта (на будущее, бот напрямую не использует). string/secret/url.
  siteAuth: {
    clientSecret: secret('DISCORD_CLIENT_SECRET', ''),
    redirectUri: url('DISCORD_REDIRECT_URI', ''),
    sessionSecret: secret('SESSION_SECRET', ''),
  },

  // ModCall. snowflake-id, '' = выключено.
  modcall: {
    panelChannelId: id('MODCALL_CHANNEL_ID', ''),
    staffChannelId: id('MODCALL_STAFF_CHANNEL_ID', ''),
  },

  // Automod (стиль Carl-bot).
  automod: {
    floodCount: int('AUTOMOD_FLOOD_COUNT', 6), // integer, сообщений
    floodSecs: int('AUTOMOD_FLOOD_SECS', 8), // integer, за N секунд
    capsMinLen: int('AUTOMOD_CAPS_MINLEN', 12), // integer, мин. длина для проверки CAPS
    capsPct: int('AUTOMOD_CAPS_PCT', 75), // integer, % заглавных
    links: bool('AUTOMOD_LINKS', true), // boolean
    linkWhitelist: list('AUTOMOD_LINK_WHITELIST', // list<string> доменов (lowercase)
      ['hpsbassline.club', 'azura.hpsbassline.club', 'youtube.com', 'youtu.be',
        'spotify.com', 'soundcloud.com', 'bandcamp.com', 'audiomack.com',
        'discord.gg', 'discord.com', 'streamable.com', 'reddit.com', 'github.com',
        'google.com', 'tiktok.com', 'instagram.com', 'twitpic.com',
        'cdn.discordapp.com', 'discordapp.net', 'tenor.com', 'giphy.com'])
      .map((s) => s.trim().toLowerCase()).filter(Boolean),
    invites: bool('AUTOMOD_INVITES', true), // boolean
    badwords: list('AUTOMOD_BADWORDS').map((s) => s.toLowerCase()), // list<string>, [] = нет
    actionHours: int('AUTOMOD_ACTION_HOURS', 1), // integer, часов мута
  },

  // Honeypot-ловушка: первое сообщение в канале = наказание.
  honeypot: {
    trapChannelId: id('HONEYPOT_CHANNEL_ID', ''), // snowflake-id, '' = ловушка выкл
    logChannelId: id('HONEYPOT_LOG_CHANNEL_ID', ''), // snowflake-id
    action: honeypotAction('HONEYPOT_ACTION', 'timeout'), // 'timeout'|'kick'|'ban'
    timeoutHours: int('HONEYPOT_TIMEOUT_HOURS', 12), // integer, часов (для timeout)
    bannerUrl: url('HONEYPOT_BANNER_URL', ''), // url картинки, '' = без баннера
  },

  // Music (Lavalink).
  music: {
    spotifyClientId: secret('SPOTIFY_CLIENT_ID', ''),
    spotifyClientSecret: secret('SPOTIFY_CLIENT_SECRET', ''),
    engine: str('MUSIC_ENGINE', 'lavalink').toLowerCase(), // string: 'lavalink'
    lavalink: {
      host: str('LAVALINK_HOST', '127.0.0.1'), // string
      port: int('LAVALINK_PORT', 2333), // integer
      password: secret('LAVALINK_PASSWORD', ''), // secret (= lavalink.server.password)
      secure: bool('LAVALINK_SECURE', false), // boolean
    },
    npUpdateSecs: int('NP_UPDATE_SECS', 10), // integer, секунд (мин. 5)
  },

  // Reposter: YT/TT/IG -> Discord (старый модуль).
  reposter: {
    youtube: envMap('YOUTUBE_MAP'), // map: "YT_CHANNEL_ID:DISCORD_CHANNEL_ID,..."
    tiktok: envMap('TIKTOK_MAP'), // map: "username:discordChannelId,..."
    instagram: envMap('INSTAGRAM_MAP'), // map: "username:discordChannelId,..."
    pollMinutes: int('REPOST_POLL_MINUTES', 10), // integer, минут
    youtubeApiKey: secret('YT_API_KEY', ''), // secret, '' = fallback RSS->scrape
    templates: {
      youtube: str('YT_TEMPLATE', '{role} **{author}** uploaded a new video!'), // template
      tiktok: str('TT_TEMPLATE', '{role} **@{user}** posted on TikTok!'), // template
      instagram: str('IG_TEMPLATE', '{role} **@{user}** posted on Instagram!'), // template
    },
    instagramSessionId: secret('IG_SESSIONID', ''),
    instagramCsrf: secret('IG_CSRFTOKEN', ''),
    instagramDid: secret('IG_DID', ''),
    instagramGraphToken: secret('IG_GRAPH_TOKEN', ''),
    instagramBusinessId: id('IG_BUSINESS_ID', ''),
  },

  // Новый Publisher: маршрутизация и источники.
  publisher: {
    live: {
      checkMinutes: int('LIVE_CHECK_MINUTES', 2), // integer, минут (YouTube live-check; минимум 1)
    },
    sources: {
      youtube: bool('PUBLISHER_YOUTUBE', true), // boolean
      twitch: bool('PUBLISHER_TWITCH', true), // boolean
      instagram: bool('PUBLISHER_INSTAGRAM', true), // boolean
      tiktok: bool('PUBLISHER_TIKTOK', true), // boolean
      hpsb: bool('PUBLISHER_HPSB', true), // boolean
    },
    announcementsChannelId: id('ANNOUNCEMENTS_CHANNEL_ID', ''), // snowflake-id
    mediaChannelId: id('MEDIA_CHANNEL_ID', ''), // snowflake-id
    partnersChannelId: id('PARTNERS_CHANNEL_ID', ''), // snowflake-id
    youtubeLiveUrl: url('YOUTUBE_LIVE_URL', ''), // url
    twitchUrl: url('TWITCH_URL', ''), // url
    twitch: {
      clientId: secret('TWITCH_CLIENT_ID', ''),
      clientSecret: secret('TWITCH_CLIENT_SECRET', ''),
      broadcasterId: id('TWITCH_BROADCASTER_ID', ''),
      eventsubSecret: secret('TWITCH_EVENTSUB_SECRET', ''),
    },
    instagram: {
      accessToken: secret('INSTAGRAM_ACCESS_TOKEN', ''),
      webhookSecret: secret('INSTAGRAM_WEBHOOK_SECRET', ''),
    },
    tiktok: {
      accessToken: secret('TIKTOK_ACCESS_TOKEN', ''),
      pollMinutes: int('TIKTOK_POLL_MINUTES', 5), // integer, минут
    },
    hpsb: {
      eventsApiUrl: url('HPSB_EVENTS_API_URL', 'https://events.hpsbassline.club/api/events'),
      eventsRssUrl: url('HPSB_EVENTS_RSS_URL', 'https://www.hpsbassline.club/api/feed/events.xml'),
      releasesApiUrl: url('HPSB_RELEASES_API_URL', 'https://rls.hpsbassline.club/api/releases'),
      releasesRssUrl: url('HPSB_RELEASES_RSS_URL', 'https://www.hpsbassline.club/api/feed/releases.xml'),
      newsRssUrl: url('HPSB_NEWS_RSS_URL', 'https://www.hpsbassline.club/api/feed/news.xml'),
    },
  },

  // HPSB фиды сайта: ОДИН источник на ленту (JSON или RSS — автоопределение).
  hpsb: {
    pollMinutes: int('HPSB_POLL_MINUTES', int('SITE_API_POLL_MINUTES', 5)), // integer, минут
    releases: {
      feedUrl: url('RELEASES_FEED_URL', 'https://release.hpsbassline.club/api/releases'),
      channelId: id('RELEASES_CHANNEL_ID', '') || id('SITE_NEWS_CHANNEL_ID', ''), // snowflake-id
      baseUrl: url('RELEASES_BASE_URL', 'https://release.hpsbassline.club', true),
      pageBase: url('RELEASES_PAGE_BASE', 'https://hpsbassline.club/releases', true),
    },
    events: {
      feedUrl: url('EVENTS_FEED_URL', 'https://www.hpsbassline.club/api/feed/events.xml'),
      channelId: id('EVENTS_CHANNEL_ID', '') || id('SITE_NEWS_CHANNEL_ID', ''), // snowflake-id
      pageBase: url('EVENTS_PAGE_BASE', 'https://hpsbassline.club/events', true),
    },
    posts: {
      apiUrl: url('POSTS_API_URL', 'https://www.hpsbassline.club/api/posts'),
      channelId: id('POSTS_CHANNEL_ID', '') || id('SITE_NEWS_CHANNEL_ID', ''), // snowflake-id
    },
  },

  // Anti-raid: всплеск заходов -> мут новичков. 0 = выкл.
  antiraid: {
    joins: int('ANTIRAID_JOINS', 8), // integer, заходов
    secs: int('ANTIRAID_SECS', 30), // integer, за N секунд
    hours: int('ANTIRAID_HOURS', 1), // integer, мут на N часов
  },

  // Счётчики онлайна (9 штук + шаблоны с {count}). ID пустой = счётчик выкл.
  stats: {
    intervalMin: int('STATS_INTERVAL_MIN', 10), // integer, минут
    members: id('STATS_MEMBERS_CHANNEL_ID', ''),
    humans: id('STATS_HUMANS_CHANNEL_ID', ''),
    bots: id('STATS_BOTS_CHANNEL_ID', ''),
    roles: id('STATS_ROLES_CHANNEL_ID', ''),
    channels: id('STATS_CHANNELS_CHANNEL_ID', ''),
    role: id('STATS_ROLE_CHANNEL_ID', ''),
    roleId: id('STATS_ROLE_ID', ''), // какую роль считать для STATS_ROLE_*
    online: id('STATS_ONLINE_CHANNEL_ID', ''),
    offline: id('STATS_OFFLINE_CHANNEL_ID', ''),
    boosts: id('STATS_BOOSTS_CHANNEL_ID', ''),
    t: {
      members: str('STATS_MEMBERS_TEMPLATE', '👥 Members: {count}'), // template {count}
      humans: str('STATS_HUMANS_TEMPLATE', '🧍 Users: {count}'),
      bots: str('STATS_BOTS_TEMPLATE', '🤖 Bots: {count}'),
      roles: str('STATS_ROLES_TEMPLATE', '🎭 Roles: {count}'),
      channels: str('STATS_CHANNELS_TEMPLATE', '📁 Channels: {count}'),
      role: str('STATS_ROLE_TEMPLATE', '🎖 {count}'),
      online: str('STATS_ONLINE_TEMPLATE', '🟢 Online: {count}'),
      offline: str('STATS_OFFLINE_TEMPLATE', '⚫ Offline: {count}'),
      boosts: str('STATS_BOOSTS_TEMPLATE', '💎 Boosts: {count}'),
    },
  },

  // Пинг ролей в анонсах. snowflake-id, '' = без пинга.
  announceRoleId: id('ANNOUNCE_ROLE_ID', ''),
  mediaRoleId: id('MEDIA_ROLE_ID', ''), // '' = используется announceRoleId

  // Приватные голосовые (стиль VoiceMaster).
  priv: {
    generatorId: id('PRIV_GENERATOR_ID', ''), // snowflake-id, '' = приватки выкл
    categoryId: id('PRIV_CATEGORY_ID', ''), // snowflake-id категории
    defaultLimit: int('PRIV_DEFAULT_LIMIT', 0), // integer, 0 = без лимита
    defaultBitrate: int('PRIV_DEFAULT_BITRATE', 64), // integer, кбит/с
    nameTemplate: str('PRIV_NAME_TEMPLATE', `{user}'s room`), // template {user}
  },

  // Автокросспост анонсов подписчикам. list<snowflake-id>.
  autopublish: list('AUTOPUBLISH_CHANNEL_IDS'),

  // Legacy single-feed (совместимость).
  siteApi: {
    url: url('SITE_API_URL', ''),
    key: secret('SITE_API_KEY', ''),
    pollMinutes: int('SITE_API_POLL_MINUTES', 5),
    channelId: id('SITE_NEWS_CHANNEL_ID', ''),
  },

  // Webhook-приёмник: внешние сервисы шлют POST сюда.
  webhook: {
    enabled: bool('WEBHOOK_ENABLED', true), // boolean, false = только polling, без HTTP-сервера
    port: int('WEBHOOK_PORT', 3100), // integer, порт (не 3001-3006)
    secret: secret('WEBHOOK_SECRET', ''), // secret
    channelId: id('WEBHOOK_NEWS_CHANNEL_ID', ''), // snowflake-id
    publicBase: url('WEBHOOK_PUBLIC_BASE', '', true), // url без слэша в конце
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

module.exports = { config, validate, parseSwitch, str, int, bool, list, envMap, id };
