// Publisher pipeline: validate -> dedup reserve -> queue -> worker(route ->
// format -> Discord send) -> mark published. Failed sends RELEASE the reservation
// so the next ingest retries; nothing is marked published before Discord confirms.
const { Dedup, keyOf } = require('./dedup');
const { createQueue } = require('./queue');
const { resolveTarget, resolveChannel, pingFor } = require('./router');
const { format, reminder } = require('./formatter');
const { loadState, saveState } = require('./state');
const { withTimeout } = require('../../utils/timeout');

const SEND_TIMEOUT_MS = 30000;

function validate(ev) {
  if (!ev || typeof ev !== 'object') return 'not an object';
  if (!ev.source || !ev.type || !ev.id) return 'source/type/id required';
  return null;
}

// Strip volatile fields so the hash only changes on real content edits
// (timestamps would differ on every build and force endless re-edits).
function payloadHash(payload) {
  try {
    const crypto = require('node:crypto');
    const embeds = (payload.embeds || []).map((e) => {
      const j = typeof e.toJSON === 'function' ? e.toJSON() : e;
      const { timestamp, ...stable } = j || {};
      return stable;
    });
    const components = (payload.components || []).map((r) => (typeof r.toJSON === 'function' ? r.toJSON() : r));
    return crypto.createHash('sha1')
      .update(JSON.stringify({ embeds, components, content: payload.content || '' }))
      .digest('hex');
  } catch {
    return '';
  }
}

function createPipeline({ client, config, log = console, sender } = {}) {
  const dedup = new Dedup();
  const queue = createQueue();
  let live = null; // live.js state, hydrated on start
  // In-memory mirror of state.posts: dedupKey -> { channelId, messageId, hash }.
  // Hydrated on start; worker records, reconcile updates/prunes, saveState persists.
  const posted = {};

  async function sendToDiscord(channelId, payload) {
    if (sender) return sender(channelId, payload);
    const ch = await withTimeout(
      client.channels.fetch(channelId).catch(() => null),
      SEND_TIMEOUT_MS, 'channel fetch');
    if (!ch?.isTextBased()) throw new Error('bad channel ' + channelId);
    const m = await withTimeout(ch.send(payload), SEND_TIMEOUT_MS, 'discord send');
    try {
      const { ChannelType } = require('discord.js');
      if (ch.type === ChannelType.GuildAnnouncement) {
        await withTimeout(m.crosspost(), SEND_TIMEOUT_MS, 'crosspost').catch(() => {});
      }
    } catch {}
    return m;
  }

  // Build the exact Discord payload for an event (+ its stable hash).
  // Shared by the worker and the missing-mode updater so edits match posts.
  // Throws on bad event data (caller must release, not commit).
  function buildPayload(ev) {
    const target = resolveTarget(ev);
    const channelId = resolveChannel(target, config);
    if (!channelId) return { channelId: '', payload: null, hash: '', target };
    const ping = pingFor(target, config);
    const liveButtons = target === 'announcements' && ev.type === 'live'
      ? require('./live').liveButtons(live || {}, config?.publisher || {})
      : [];
    const built = ev?.metadata?.reminderTier
      ? { ...reminder(ev, ev.metadata.reminderTier), saveable: false }
      : format(ev, { liveButtons });
    const payload = { embeds: [built.embed] };
    if (ping) payload.content = ping;
    const rows = [...(built.components || [])];
    // ★ Save button on media posts (max 5 rows total per Discord limits).
    if (built.saveable && rows.length < 5) {
      const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('pub:save').setLabel('★ Save').setStyle(ButtonStyle.Secondary),
      ));
    }
    if (rows.length) payload.components = rows;
    return { channelId, payload, hash: payloadHash(payload), target };
  }

  async function worker({ ev, key }) {
    let channelId = '';
    let payload = null;
    let hash = '';
    try {
      const built = buildPayload(ev);
      channelId = built.channelId;
      payload = built.payload;
      hash = built.hash || '';
      if (!channelId || !payload) throw new Error('no channel or payload');
    } catch (e) {
      const msg = String(e?.message || e);
      if (msg === 'no channel or payload' && !channelId) {
        log.warn?.(`[publisher] no channel for target ${resolveTarget(ev)}, dropping ${key}`);
        dedup.commit(key); // configured nowhere: keeping it pending would retry forever
        try {
          await saveState({ seen: dedup.dumpSeen(), posts: { ...posted } });
        } catch (err) {
          log.warn?.('[publisher] state save failed', err?.message || err);
        }
        return;
      }
      // Bad event data (e.g. unusable url/image) must not wedge the key in pending.
      dedup.release(key);
      log.warn?.(`[publisher] format failed ${key}, released:`, msg);
      return;
    }
    try {
      const m = await sendToDiscord(channelId, payload);
      // Auto-thread under releases: each release gets its own discussion.
      // Announcement channels support threads; anything else is best-effort.
      try {
        if (ev?.source === 'hpsb' && ev?.type === 'release'
          && config?.hpsb?.releases?.threads !== false
          && m && typeof m.startThread === 'function') {
          await withTimeout(
            m.startThread({ name: `💬 ${String(ev.title || 'Release').slice(0, 90)}`, autoArchiveDuration: 1440 }),
            SEND_TIMEOUT_MS, 'thread create').catch(() => {});
        }
      } catch {}
      // Remember the Discord message: future syncs EDIT it instead of reposting.
      if (m?.id) posted[key] = { channelId, messageId: m.id, hash };
      dedup.commit(key);
    } catch (e) {
      dedup.release(key);
      log.warn?.(`[publisher] send failed ${key}:`, e?.message || e);
      return;
    }
    try {
      await saveState({ seen: dedup.dumpSeen(), posts: { ...posted } });
    } catch (e) {
      log.warn?.('[publisher] state save failed', e?.message || e);
    }
  }

  async function ingest(ev, opts = {}) {
    const err = validate(ev);
    if (err) {
      log.warn?.('[publisher] invalid event dropped:', err);
      return { ok: false, reason: err };
    }
    const key = dedup.reserve(ev, { force: !!opts.force });
    if (!key) return { ok: false, reason: 'duplicate' };
    if (!queue.push({ ev, key })) {
      dedup.release(key);
      return { ok: false, reason: 'stopped' };
    }
    return { ok: true, key };
  }

  function setLive(st) { live = st; }
  function getLive() { return live; }

  return {
    ingest, worker, queue, dedup, keyOf, posted, buildPayload, payloadHash,
    setLive, getLive,
    start: (lopts) => queue.start((job) => worker(job, lopts)),
    stop: () => {
      queue.stop();
      // Hand back unprocessed jobs: keys must neither wedge in pending nor be
      // committed without posting -- next boot re-fetches and posts them.
      try {
        for (const job of queue.takeAll()) {
          if (job?.key) dedup.release(job.key);
        }
      } catch {}
    },
  };
}

module.exports = { createPipeline, validate };
