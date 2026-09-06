// Outbox — the three field actions keep working with no signal.
//
// THE PROBLEM THIS SOLVES
//
// The service worker already makes the app *open* on a dead connection: the
// app shell and the last synced data come out of the cache, so a rep standing
// outside a shop in Mbare can still look up who they're about to walk in on.
// But every WRITE went straight to Supabase and, with no signal, straight into
// a red error toast. So the app opened, showed you the prospect, and then
// refused to let you record what just happened — which is the one thing you
// actually need to do while you're standing there. In practice that means the
// update gets written on the back of a hand and re-typed hours later, if at
// all.
//
// So: those writes now go into a queue on the phone first, take effect on
// screen immediately, and are sent the moment there's a connection again —
// which might be five seconds later when the bar comes back, or tomorrow
// morning on the office WiFi. The queue survives closing the app, killing the
// browser, and restarting the phone, because it lives in localStorage rather
// than in memory.
//
// WHAT IS AND ISN'T IN HERE, AND WHY
//
// Only three actions: change a status, set a follow-up date, post a note.
// Those are the ones that happen with a phone in one hand and no signal. They
// were also chosen because all three are SAFE to send late, which most of this
// app's writes are not:
//
//   A status and a follow-up date are single fields on one prospect, so
//   sending a stale one late is last-write-wins on that field only — the
//   ordinary outcome of two people editing the same box, no worse.
//
//   A note is append-only. It can't clobber anything, and arriving late just
//   means it arrives late.
//
// Deliberately NOT queued, and these are the interesting ones:
//
//   Claiming or assigning a prospect. Whether you get it depends on whether
//   someone else already has it — that's a race the server decides (there's a
//   claim_prospect function for exactly this reason). Queueing it would mean
//   telling someone "it's yours" while offline and taking it away again an
//   hour later. Better to say "you need signal for this" up front.
//
//   Deleting a prospect. An irreversible action should never be in flight
//   without confirmation that it happened.
//
//   Bulk edits, contracts, invoices, projects, grid plans. These are desk
//   work, done sitting down on a connection. Queueing them would add real risk
//   (a queued invoice total overwriting a corrected one) to buy nothing.
//
// SENDING TWICE IS FINE, BY CONSTRUCTION
//
// The nastiest case on bad mobile data isn't a request that fails — it's one
// that reaches the server, is applied, and then the reply is lost on the way
// back. The phone can't tell that apart from a request that never arrived, so
// it will send again. Both job types are built so that a second delivery is
// harmless:
//
//   A field patch re-sends the same value, so applying it twice is identical
//   to applying it once.
//
//   A note carries an id generated HERE, on the phone, instead of letting the
//   database make one up. A repeat delivery therefore collides with the row
//   that already landed and is rejected as a duplicate key — which this file
//   reads as "good, it's already there" rather than as an error.

import { sb } from "./supabaseClient.js";
import { store, emitProspects, emitNotes, setOutboxDecorators } from "./state.js";

const KEY = "sxc-outbox-v1";

// How often to try again while something is still waiting. navigator.onLine
// is not a connectivity test — it only reports whether the device thinks it
// has a network interface, so it stays true on a carrier data connection that
// is technically attached and passing nothing. That's the normal state of a
// weak signal, and it means the "online" event alone would never fire to wake
// us up. Hence a plain timer as well.
const RETRY_MS = 60000;

// Jobs older than this are dropped unsent. A fortnight-old status change is no
// longer information, it's misinformation: whatever the prospect's status is
// today, it was set by someone who could see more recent facts than a phone
// that has been in a drawer. The queue is not an archive.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let queue = load();
let flushing = false;
let timer = 0;
const watchers = [];

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupt or unreadable (private-mode quota, a half-written value from a
    // browser killed mid-save). An empty queue loses unsent edits, which is
    // bad, but a queue that throws on every read breaks the whole app, which
    // is worse.
    return [];
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(queue));
  } catch {
    // Out of storage. Nothing useful to do — the in-memory queue still works
    // for this session, it just won't survive a restart.
  }
  watchers.forEach((fn) => fn(queue.length));
}

// Not crypto.randomUUID() alone: that is only available on a secure origin,
// and while the deployed app is always HTTPS, the app is also opened over
// plain http on a laptop during setup, where it is undefined and would throw.
function newId() {
  if (self.crypto && typeof self.crypto.randomUUID === "function") return self.crypto.randomUUID();
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
    else if (i === 14) out += "4";
    else out += hex[Math.floor(Math.random() * 16)];
  }
  return out;
}

export function outboxCount() {
  return queue.length;
}

// Fires with the new count every time the queue changes, so the banner can
// say how many things are still waiting without polling.
export function onOutboxChange(fn) {
  watchers.push(fn);
  return () => {
    const i = watchers.indexOf(fn);
    if (i >= 0) watchers.splice(i, 1);
  };
}

// ---- putting things in -----------------------------------------------------

// Change one or more fields on a prospect. Takes effect on screen straight
// away and is sent as soon as there's a connection.
//
// Repeated calls for the same prospect MERGE into the one queued job rather
// than stacking up. Somebody who taps through Not contacted -> Sent -> Replied
// while out of signal should send one write saying "Replied", not three writes
// replaying a sequence that no longer means anything. Merging also means the
// queue can't grow without bound while somebody fiddles with a dropdown.
export function patchProspect(prospectId, patch) {
  const existing = queue.find((j) => j.kind === "prospect-patch" && j.prospectId === prospectId);
  if (existing) {
    Object.assign(existing.patch, patch);
    existing.at = Date.now();
  } else {
    queue.push({ id: newId(), kind: "prospect-patch", prospectId, patch: { ...patch }, at: Date.now() });
  }
  save();

  const p = store.prospects.find((x) => x.id === prospectId);
  if (p) Object.assign(p, patch);
  emitProspects();

  return flushOutbox();
}

// Post a note. The id is made here rather than by the database — see the
// "sending twice is fine" note at the top of this file.
export function postNote(prospectId, body) {
  const job = {
    id: newId(),
    kind: "note",
    prospectId,
    body,
    authorId: store.profile?.id || null,
    at: Date.now(),
  };
  queue.push(job);
  save();
  emitNotes(prospectId);
  return flushOutbox();
}

// ---- keeping un-sent edits on screen ---------------------------------------
//
// Every few seconds something replaces store.prospects or a prospect's notes
// with a fresh copy from the server: the periodic resync, a teammate's live
// update, coming back to the app from the lock screen. That server copy does
// not contain anything still sitting in this queue, so without these two the
// status you just set would appear, then silently revert to the old one the
// next time anything refreshed — which looks exactly like the app losing your
// work, and is the failure people would trust least.
//
// state.js calls both of these on every such refresh (see setOutboxDecorators
// at the bottom of this file).

function decorateProspects(list) {
  if (!queue.length || !list) return;
  queue.forEach((job) => {
    if (job.kind !== "prospect-patch") return;
    const p = list.find((x) => x.id === job.prospectId);
    if (p) Object.assign(p, job.patch);
  });
}

function decorateNotes(prospectId, list) {
  if (!list) return;

  // Drop any still-sending note whose job has since left the queue. Without
  // this the placeholder would sit there wearing "Sending…" forever after the
  // real note was saved, on any screen that didn't happen to refetch. Note
  // this runs even when the queue is empty — that IS the case where the last
  // note just went out and its placeholder needs clearing.
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]._pending && !queue.some((j) => j.id === list[i].id)) list.splice(i, 1);
  }
  if (!queue.length) return;

  queue.forEach((job) => {
    if (job.kind !== "note" || job.prospectId !== prospectId) return;
    // Already arrived (the note went out, and this refresh is the server's
    // own copy of it coming back) — the queue just hasn't been trimmed yet.
    if (list.some((n) => n.id === job.id)) return;
    list.push({
      id: job.id,
      prospect_id: job.prospectId,
      author_id: job.authorId,
      body: job.body,
      created_at: new Date(job.at).toISOString(),
      // Read by renderNotes() in prospectDetail.js to mark the note as still
      // on its way. Prefixed to make it obvious at a glance that this is not
      // a column on prospect_notes.
      _pending: true,
    });
  });
  list.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
}

// ---- getting things out ----------------------------------------------------

// Did this fail because the network is bad, or because the server looked at it
// and said no?
//
// It matters enormously: a bad network means keep the job and try again, while
// a rejection means this will fail identically forever and must be dropped, or
// the queue jams and nothing behind it ever sends again.
//
// supabase-js reports both through the same { error } shape, but fills in
// `code` only when a real reply came back from PostgREST (a permissions
// refusal, a constraint violation, a bad value). A request that never got an
// answer has no code to report. So an empty code means the message never made
// it there and is worth repeating.
function isTransient(error) {
  if (!error) return false;
  return !error.code;
}

async function send(job) {
  if (job.kind === "prospect-patch") {
    const { error } = await sb.from("prospects").update(job.patch).eq("id", job.prospectId);
    return error;
  }
  if (job.kind === "note") {
    const { error } = await sb.from("prospect_notes").insert({
      id: job.id,
      prospect_id: job.prospectId,
      author_id: job.authorId,
      body: job.body,
    });
    // 23505 is Postgres' unique-violation code: a row with this id is already
    // in the table, which can only be this exact note from an earlier attempt
    // whose reply got lost. That's a success that looked like a failure.
    if (error && error.code === "23505") return null;
    return error;
  }
  return null; // Unknown kind (an older/newer version of this file wrote it) — drop it.
}

// Sends everything waiting, oldest first, and stops at the first job that
// couldn't get through.
//
// Stopping rather than skipping ahead is deliberate. If the connection died on
// job 1 it has almost certainly died for job 2 as well, so carrying on would
// just be a burst of doomed requests. More importantly, order is meaning here:
// a note explaining a status change should not arrive before the status change
// it explains.
export async function flushOutbox() {
  if (flushing) return;
  if (!queue.length) return;
  if (!navigator.onLine) {
    schedule();
    return;
  }
  flushing = true;

  const touchedProspects = new Set();
  const touchedNotes = new Set();

  try {
    while (queue.length) {
      const job = queue[0];

      if (Date.now() - job.at > MAX_AGE_MS) {
        queue.shift();
        save();
        continue;
      }

      let error;
      try {
        error = await send(job);
      } catch (err) {
        // A thrown exception (rather than a returned error) is what a hard
        // network failure looks like from fetch itself.
        error = { message: String(err && err.message ? err.message : err), code: "" };
      }

      if (error && isTransient(error)) break;

      if (error) {
        // The server answered and refused. Retrying is pointless, and leaving
        // it at the head of the queue would block every later job forever.
        console.error("outbox: dropping a job the server rejected", job.kind, error);
        const { toast } = await import("./utils.js");
        toast(`Couldn't save one change: ${error.message}`, "error");
      }

      if (job.kind === "prospect-patch") touchedProspects.add(job.prospectId);
      if (job.kind === "note") touchedNotes.add(job.prospectId);
      queue.shift();
      save();
    }
  } finally {
    flushing = false;
  }

  // Re-render whatever the queue was propping up. Without this, a note that
  // has now genuinely been saved would keep its "Sending…" mark until the
  // next unrelated refresh happened to come along.
  if (touchedProspects.size) emitProspects();
  touchedNotes.forEach((pid) => emitNotes(pid));

  if (queue.length) schedule();
}

function schedule() {
  if (timer || !queue.length) return;
  timer = window.setTimeout(() => {
    timer = 0;
    flushOutbox();
  }, RETRY_MS);
}

export function initOutbox() {
  setOutboxDecorators({ prospects: decorateProspects, notes: decorateNotes });

  window.addEventListener("online", () => flushOutbox());

  // Coming back to the app is the single best moment to try: it is usually the
  // moment someone has walked back into signal, or into the office, and it
  // costs nothing when there's nothing waiting.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") flushOutbox();
  });

  // Anything left over from a previous session — the app was closed with edits
  // still unsent, and this is the first chance to deliver them.
  flushOutbox();
}
