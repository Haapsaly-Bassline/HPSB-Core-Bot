// Publisher pipeline: validate -> dedup reserve -> queue -> worker(route ->
// format -> Discord send) -> mark published. Failed sends RELEASE the reservation
// so the next ingest retries; nothing is marked published before Discord confirms.
const { Dedup, keyOf } = require('./dedup');
const { createQueue } = require('./queue');
const { resolveTarget, resolveChannel, pingFor } = require('./router');
const { format, reminder } = require('./formatter');
const { loadState, saveState } = require('./state');

function validate(ev) {
  if (!ev || typeof ev !== 'object') return 'not an object';
  if (!ev.source || !ev.type || !ev.id) return 'source/type/id required';
  return null;
}

function createPipeline({ client, config, log = console, sender } = {}) {
  const dedup = new Dedup();
  const queue = createQueue();
  let live = null; // live.js state, hydrated on start

  async function sendToDiscord(channelId, payload) {
    if (sender) return sender(channelId, payload);
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch?.isTextBased()) throw new Error('bad channel ' + channelId);
    const m = await ch.send(payload);
    try {
      const { ChannelType } = require('discord.js');
      if (ch.type === ChannelType.GuildAnnouncement) await m.crosspost().catch(() => {});
    } catch {}
    return m;
  }

  async function worker({ ev, key }) {
    const target = resolveTarget(ev);
    const channelId = resolveChannel(target, config);
    if (!channelId) {
      log.warn?.(`[publisher] no channel for target ${target}, dropping ${key}`);
      dedup.commit(key); // configured nowhere: keeping it pending would retry forever
      try {
        await saveState({ seen: dedup.dumpSeen() });
      } catch (e) {
        log.warn?.('[publisher] state save failed', e?.message || e);
      }
      return;
    }
    const ping = pingFor(target, config);
    const liveButtons = target === 'announcements' && ev.type === 'live'
      ? require('./live').liveButtons(live || {}, config?.publisher || {})
      : [];
    let payload;
    try {
      const built = ev?.metadata?.reminderTier
        ? { ...reminder(ev, ev.metadata.reminderTier), saveable: false }
        : format(ev, { liveButtons });
      payload = { embeds: [built.embed] };
      if (ping) payload.content = ping;
      const rows = [...(built.components || [])];
      // 🔖 Save button on media posts (max 5 rows total per Discord limits).
      if (built.saveable && rows.length < 5) {
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        rows.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('pub:save').setLabel('🔖 Save').setStyle(ButtonStyle.Secondary),
        ));
      }
      if (rows.length) payload.components = rows;
    } catch (e) {
      // Bad event data (e.g. unusable url/image) must not wedge the key in pending.
      dedup.release(key);
      log.warn?.(`[publisher] format failed ${key}, released:`, e?.message || e);
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
          await m.startThread({ name: `💬 ${String(ev.title || 'Release').slice(0, 90)}`, autoArchiveDuration: 1440 }).catch(() => {});
        }
      } catch {}
      dedup.commit(key);
    } catch (e) {
      dedup.release(key);
      log.warn?.(`[publisher] send failed ${key}:`, e?.message || e);
      return;
    }
    try {
      await saveState({ seen: dedup.dumpSeen() });
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
    ingest, worker, queue, dedup, keyOf,
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
