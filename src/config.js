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

// Module switch: on/true/1 = on; off/false/0 = off; missing = defaultValue.
function parseSwitch(str, defaultValue = true) {
  if (str === undefined || str === null || String(str).trim() === '') return defaultValue;
  const v = String(str).trim().toLowerCase();
  if (['on', 'true', '1', 'yes', 'enable', 'enabled'].includes(v)) return true;
  if (['off', 'false', '0', 'no', 'disable', 'disabled'].includes(v)) return false;
  return defaultValue;
}

const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID,
  guildId: process.env.GUILD_ID,
  modRoleId: process.env.MOD_ROLE_ID,
  logChannelId: process.env.LOG_CHANNEL_ID || '',
  adminIds: parseIds(process.env.ADMIN_DISCORD_IDS),

  // Module defaults (.env overrides; Discord /modules overrides persist on top).
  modules: {
    music: parseSwitch(process.env.MODULE_MUSIC, true),
    publisher: parseSwitch(process.env.MODULE_PUBLISHER, true),
    automod: parseSwitch(process.env.MODULE_AUTOMOD, true),
    honeypot: parseSwitch(process.env.MODULE_HONEYPOT, true),
    modcall: parseSwitch(process.env.MODULE_MODCALL, true),
    stats: parseSwitch(process.env.MODULE_STATS, true),
    private: parseSwitch(process.env.MODULE_PRIVATE, true),
  },

  // For future OAuth integration with website (not used by bot directly yet)
  siteAuth: {
    clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
    redirectUri: process.env.DISCORD_REDIRECT_URI || '',
    sessionSecret: process.env.SESSION_SECRET || '',
  },

  modcall: {
    // Empty = disabled until configured (never arm on someone else's hardcoded IDs).
    panelChannelId: process.env.MODCALL_CHANNEL_ID || '',
    staffChannelId: process.env.MODCALL_STAFF_CHANNEL_ID || '',
  },

  automod: {
    floodCount: Number(process.env.AUTOMOD_FLOOD_COUNT || 6),
    floodSecs: Number(process.env.AUTOMOD_FLOOD_SECS || 8),
    capsMinLen: Number(process.env.AUTOMOD_CAPS_MINLEN || 12),
    capsPct: Number(process.env.AUTOMOD_CAPS_PCT || 75),
    links: (process.env.AUTOMOD_LINKS || 'on') === 'on',
    linkWhitelist: (process.env.AUTOMOD_LINK_WHITELIST || 'hpsbassline.club,azura.hpsbassline.club,youtube.com,youtu.be,spotify.com,soundcloud.com,bandcamp.com,audiomack.com,discord.gg,discord.com,streamable.com,reddit.com,github.com,google.com,tiktok.com,instagram.com,twitpic.com,cdn.discordapp.com,discordapp.net,tenor.com,giphy.com').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
    invites: (process.env.AUTOMOD_INVITES || 'on') === 'on',
    badwords: (process.env.AUTOMOD_BADWORDS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
    actionHours: Number(process.env.AUTOMOD_ACTION_HOURS || 1),
  },

  honeypot: {
    // Empty trap = disabled until configured (never arm on someone else's hardcoded IDs).
    trapChannelId: process.env.HONEYPOT_CHANNEL_ID || '',
    logChannelId: process.env.HONEYPOT_LOG_CHANNEL_ID || '',
    // Public trap: first message in channel = punishment.
    // action: timeout (mute) | kick | ban; timeoutHours = mute duration.
    action: process.env.HONEYPOT_ACTION || 'timeout',
    timeoutHours: Number(process.env.HONEYPOT_TIMEOUT_HOURS || 12),
    // Banner URL for warning (upload WARNING image to Discord and paste link). Without it -- plain red embed.
    bannerUrl: process.env.HONEYPOT_BANNER_URL || '',
  },

  music: {
    // Keys duplicated in lavalink/application.yml (LavaSrc-Spotify). Bot reads them via node.
    spotifyClientId: process.env.SPOTIFY_CLIENT_ID || '',
    spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
    // Single engine -- lavalink. Legacy hpsb engine removed (bot is exclusively on lavalink).
    engine: (process.env.MUSIC_ENGINE || 'lavalink').toLowerCase(),
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
    // Free YouTube Data API v3 key (console.cloud.google.com, quota is plenty).
    // Without it: RSS -> scrape. With it -> perfectly accurate.
    youtubeApiKey: process.env.YT_API_KEY || '',
    // EN media post templates. Placeholders: {role} {author} {user} {title} {link}
    templates: {
      youtube: process.env.YT_TEMPLATE || '{role} **{author}** uploaded a new video!',
      tiktok: process.env.TT_TEMPLATE || '{role} **@{user}** posted on TikTok!',
      instagram: process.env.IG_TEMPLATE || '{role} **@{user}** posted on Instagram!',
    },
    // Instagram without subscription: like other bots -- scrape public profile.
    // Optionally speed up/stabilize with your session cookie (see .env.example).
    instagramSessionId: process.env.IG_SESSIONID || '',
    instagramCsrf: process.env.IG_CSRFTOKEN || '',
    instagramDid: process.env.IG_DID || '',
    instagramGraphToken: process.env.IG_GRAPH_TOKEN || '',
    instagramBusinessId: process.env.IG_BUSINESS_ID || '',
  },

  // New Publisher routing/targets (legacy keys above stay as fallbacks).
  publisher: {
    sources: {
      youtube: parseSwitch(process.env.PUBLISHER_YOUTUBE, true),
      twitch: parseSwitch(process.env.PUBLISHER_TWITCH, true),
      instagram: parseSwitch(process.env.PUBLISHER_INSTAGRAM, true),
      tiktok: parseSwitch(process.env.PUBLISHER_TIKTOK, true),
      hpsb: parseSwitch(process.env.PUBLISHER_HPSB, true),
    },
    announcementsChannelId: process.env.ANNOUNCEMENTS_CHANNEL_ID || '',
    mediaChannelId: process.env.MEDIA_CHANNEL_ID || '',
    partnersChannelId: process.env.PARTNERS_CHANNEL_ID || '',
    youtubeLiveUrl: process.env.YOUTUBE_LIVE_URL || '',
    twitchUrl: process.env.TWITCH_URL || '',
    twitch: {
      clientId: process.env.TWITCH_CLIENT_ID || '',
      clientSecret: process.env.TWITCH_CLIENT_SECRET || '',
      broadcasterId: process.env.TWITCH_BROADCASTER_ID || '',
      eventsubSecret: process.env.TWITCH_EVENTSUB_SECRET || '',
    },
    instagram: {
      accessToken: process.env.INSTAGRAM_ACCESS_TOKEN || '',
      webhookSecret: process.env.INSTAGRAM_WEBHOOK_SECRET || '',
    },
    tiktok: {
      accessToken: process.env.TIKTOK_ACCESS_TOKEN || '',
      pollMinutes: Number(process.env.TIKTOK_POLL_MINUTES || 5),
    },
    hpsb: {
      eventsApiUrl: process.env.HPSB_EVENTS_API_URL || 'https://events.hpsbassline.club/api/events',
      eventsRssUrl: process.env.HPSB_EVENTS_RSS_URL || 'https://www.hpsbassline.club/api/feed/events.xml',
      releasesApiUrl: process.env.HPSB_RELEASES_API_URL || 'https://rls.hpsbassline.club/api/releases',
      releasesRssUrl: process.env.HPSB_RELEASES_RSS_URL || 'https://www.hpsbassline.club/api/feed/releases.xml',
      newsRssUrl: process.env.HPSB_NEWS_RSS_URL || 'https://www.hpsbassline.club/api/feed/news.xml',
    },
  },

  // HPSB services: ONE source per feed (format auto-detected)
  hpsb: {
    pollMinutes: Number(process.env.HPSB_POLL_MINUTES || process.env.SITE_API_POLL_MINUTES || 5),
    releases: {
      feedUrl: process.env.RELEASES_FEED_URL || 'https://release.hpsbassline.club/api/releases',
      channelId: process.env.RELEASES_CHANNEL_ID || process.env.SITE_NEWS_CHANNEL_ID || '',
      baseUrl: (process.env.RELEASES_BASE_URL || 'https://release.hpsbassline.club').replace(/\/$/, ''),
      pageBase: (process.env.RELEASES_PAGE_BASE || 'https://hpsbassline.club/releases').replace(/\/$/, ''),
    },
    events: {
      feedUrl: process.env.EVENTS_FEED_URL || 'https://www.hpsbassline.club/api/feed/events.xml',
      channelId: process.env.EVENTS_CHANNEL_ID || process.env.SITE_NEWS_CHANNEL_ID || '',
      pageBase: (process.env.EVENTS_PAGE_BASE || 'https://hpsbassline.club/events').replace(/\/$/, ''),
    },
    posts: {
      apiUrl: process.env.POSTS_API_URL || 'https://www.hpsbassline.club/api/posts',
      channelId: process.env.POSTS_CHANNEL_ID || process.env.SITE_NEWS_CHANNEL_ID || '',
    },
  },

  // Anti-raid: join spike -> mute newcomers. 0 = off.
  antiraid: {
    joins: Number(process.env.ANTIRAID_JOINS || 8),
    secs: Number(process.env.ANTIRAID_SECS || 30),
    hours: Number(process.env.ANTIRAID_HOURS || 1),
  },

  // Member Count parity: 9 counters + {count} templates + on/off
  stats: {
    intervalMin: Number(process.env.STATS_INTERVAL_MIN || 10),
    members: process.env.STATS_MEMBERS_CHANNEL_ID || '',
    humans: process.env.STATS_HUMANS_CHANNEL_ID || '',
    bots: process.env.STATS_BOTS_CHANNEL_ID || '',
    roles: process.env.STATS_ROLES_CHANNEL_ID || '',
    channels: process.env.STATS_CHANNELS_CHANNEL_ID || '',
    role: process.env.STATS_ROLE_CHANNEL_ID || '',
    roleId: process.env.STATS_ROLE_ID || '',
    online: process.env.STATS_ONLINE_CHANNEL_ID || '',
    offline: process.env.STATS_OFFLINE_CHANNEL_ID || '',
    boosts: process.env.STATS_BOOSTS_CHANNEL_ID || '',
    t: {
      members: process.env.STATS_MEMBERS_TEMPLATE || '👥 Members: {count}',
      humans: process.env.STATS_HUMANS_TEMPLATE || '🧍 Users: {count}',
      bots: process.env.STATS_BOTS_TEMPLATE || '🤖 Bots: {count}',
      roles: process.env.STATS_ROLES_TEMPLATE || '🎭 Roles: {count}',
      channels: process.env.STATS_CHANNELS_TEMPLATE || '📁 Channels: {count}',
      role: process.env.STATS_ROLE_TEMPLATE || '🎖 {count}',
      online: process.env.STATS_ONLINE_TEMPLATE || '🟢 Online: {count}',
      offline: process.env.STATS_OFFLINE_TEMPLATE || '⚫ Offline: {count}',
      boosts: process.env.STATS_BOOSTS_TEMPLATE || '💎 Boosts: {count}',
    },
  },

  // Role for ping in announcements (media + news). Empty = no ping.
  announceRoleId: process.env.ANNOUNCE_ROLE_ID || '',
  // Separate role for MEDIA posts (YT/IG/TT). Empty = general announceRoleId.
  mediaRoleId: process.env.MEDIA_ROLE_ID || '',

  // Private voice (VoiceMaster-style): joined generator -> own room + panel
  priv: {
    generatorId: process.env.PRIV_GENERATOR_ID || '', // empty = private rooms disabled
    categoryId: process.env.PRIV_CATEGORY_ID || '',
    defaultLimit: Number(process.env.PRIV_DEFAULT_LIMIT || 0),
    defaultBitrate: Number(process.env.PRIV_DEFAULT_BITRATE || 64),
    nameTemplate: process.env.PRIV_NAME_TEMPLATE || `{user}'s room`,
  },

  // Auto-crosspost from announcement channels to subscribers (comma-separated IDs)
  autopublish: parseIds(process.env.AUTOPUBLISH_CHANNEL_IDS),

  // legacy single-feed (kept for compatibility)
  siteApi: {
    url: process.env.SITE_API_URL || '',
    key: process.env.SITE_API_KEY || '',
    pollMinutes: Number(process.env.SITE_API_POLL_MINUTES || 5),
    channelId: process.env.SITE_NEWS_CHANNEL_ID || '',
  },

  webhook: {
    port: Number(process.env.WEBHOOK_PORT || 3100),
    secret: process.env.WEBHOOK_SECRET || '',
    channelId: process.env.WEBHOOK_NEWS_CHANNEL_ID || '',
    publicBase: process.env.WEBHOOK_PUBLIC_BASE || '',
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

module.exports = { config, validate, parseSwitch };
