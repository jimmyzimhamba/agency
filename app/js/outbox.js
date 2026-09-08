// Outbox, the field actions keep working with no signal.
//
// THE PROBLEM THIS SOLVES
//
// The service worker already makes the app *open* on a dead connection: the
// app shell and the last synced data come out of the cache, so a rep standing
// outside a shop in Mbare can still look up who they're about to walk in on.
// But every WRITE went straight to Supabase and, with no signal, straight into
// a red error toast. So the app opened, showed you the prospect, and then
// refused to let you record what just happened, which is the one thing you
// actually need to do while you're standing there. In practice that means the
// update gets written on the back of a hand and re-typed hours later, if at
// all.
//
// So: those writes now go into a queue on the phone first, take effect on
// screen immediately, and are sent the moment there's a connection again, // which might be five seconds later when the bar comes back, or tomorrow
// morning on the office WiFi. The queue survives closing the app, killing the
// browser, and restarting the phone, because it lives in localStorage rather
// than in memory.
//
// WHAT IS AND ISN'T IN HERE, AND WHY
//
// Five actions: add a prospect, change a status, set a follow-up date, post a
// note, and tick off a daily mission. Those are the ones that happen with a
// phone in one hand and no signal. They were also chosen because all five are
// SAFE to send late, which most of this app's writes are not:
//
//   Adding a prospect is a brand-new row. There is nothing there yet for it to
//   overwrite and nobody else editing it, so a late arrival changes nothing
//   except when the row appears.
//
//   A status and a follow-up date are single fields on one prospect, so
//   sending a stale one late is last-write-wins on that field only, the
//   ordinary outcome of two people editing the same box, no worse.
//
//   A note is append-only. It can't clobber anything, and arriving late just
//   means it arrives late.
//
//   A mission tick is one person's own row for one mission on one date, and
//   nobody else can write it, so nothing can be racing it, and arriving late
//   is invisible.
//
// Adding a prospect is the one that makes the other four worth having. Walking
// a street writing down shops is the actual job, and it happens exactly where
// the signal is worst. Without it the app could tell you about businesses
// somebody else had already typed in, but the moment you found a new one it
// had nothing for you.
//
// Deliberately NOT queued, and these are the interesting ones:
//
//   Claiming or assigning a prospect. Whether you get it depends on whether
//   someone else already has it, that's a race the server decides (there's a
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
// The nastiest case on bad mobile data isn't a request that fails, it's one
// that reaches the server, is applied, and then the reply is lost on the way
// back. The phone can't tell that apart from a request that never arrived, so
// it will send again. Every job type is built so that a second delivery is
// harmless:
//
//   A field patch re-sends the same value, so applying it twice is identical
//   to applying it once.
//
//   A note and a new prospect both carry an id generated HERE, on the phone,
//   instead of letting the database make one up. A repeat delivery therefore
//   collides with the row that already landed and is rejected as a duplicate
//   key, which this file reads as "good, it's already there" rather than as
//   an error. Without that, a shop added at the edge of a signal could end up
//   in the pipeline twice, and the second copy would look like a genuine
//   second business rather than an obvious mistake.
//
//   A mission tick is already written as an upsert keyed on (mission, person,
//   date), so a second delivery lands on the same row and writes the same
//   value. Nothing needed adding for that one; it was idempotent already.
//
// ORDER IS NOW LOAD-BEARING
//
// Adding a shop and then straight away setting its status, or writing a note
// on it, is completely normal, that's one conversation outside one door. Those
// later jobs refer to a row that does not exist on the server yet, so they can
// only work if the insert goes first. It does: the queue drains oldest-first
// and STOPS at the first job that couldn't get through rather than skipping
// past it, so nothing can overtake the insert it depends on. That was already
// true for a softer reason (a note shouldn't arrive before the status change
// it explains); it is now a correctness requirement.

import { sb } from "./supabaseClient.js";
import {
  store,
  emitProspects,
  emitNotes,
  emitDailyCompletions,
  refreshProspects,
  refreshDailyCompletions,
  setOutboxDecorators,
} from "./state.js";
import { notify } from "./push.js";

const KEY = "sxc-outbox-v1";

// How often to try again while something is still waiting. navigator.onLine
// is not a connectivity test, it only reports whether the device thinks it
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
    // Out of storage. Nothing useful to do, the in-memory queue still works
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

// Add a brand-new prospect. Returns the id it will have, which is generated
// here so that the rest of the app can start using it, opening the prospect,
// setting a status, writing a note, long before the server has heard of it.
//
// `payload` is the form's own field values. `wantsResearch` says the message
// box was left blank, so the AI should write the outreach message once this
// actually reaches the server.
//
// The row that goes on screen is assembled here rather than waiting for the
// server's copy, which means the defaults below have to match the ones in
// schema.sql. They are the columns the pipeline card and the detail sheet read
//, get one wrong and a freshly added shop renders blank or, worse, in the
// wrong status column. (org_id is deliberately absent: a database trigger
// fills it in, and it isn't needed to draw anything.)
export function addProspect(payload, wantsResearch) {
  const id = newId();
  const now = new Date().toISOString();

  const row = {
    id,
    status: "not_contacted",
    research_summary: "",
    research_status: wantsResearch ? "researching" : "pending",
    message_source: "manual",
    researched_at: null,
    google_place_id: null,
    liora_conflict: false,
    whatsapp_last_inbound_at: null,
    created_at: now,
    updated_at: now,
    ...payload,
  };

  queue.push({ id: newId(), kind: "prospect-insert", prospectId: id, row, wantsResearch, at: Date.now() });
  save();
  emitProspects();
  return id;
}

// Throw away a queued prospect that hasn't been sent yet.
//
// Deleting is normally a live write, and deliberately so, you should never be
// told something irreversible happened without confirmation that it did. But a
// prospect that is still only in this queue is a special case: nothing has
// happened yet, so there is nothing to confirm. Cancelling the job is the whole
// job. Without this, deleting a shop you'd just mistyped would fail with a
// network error and then the mistake would turn up in everyone's pipeline an
// hour later anyway.
//
// Returns true if there was one to cancel, so the caller knows whether it still
// needs to ask the server.
export function cancelPendingProspect(prospectId) {
  const i = queue.findIndex((j) => j.kind === "prospect-insert" && j.prospectId === prospectId);
  if (i < 0) return false;

  // Anything queued behind it referred to a row that is now never going to
  // exist, so it would only fail on arrival.
  queue = queue.filter((j) => j.prospectId !== prospectId);
  save();

  const at = store.prospects.findIndex((p) => p.id === prospectId);
  if (at >= 0) store.prospects.splice(at, 1);
  // Any notes written on it go too. Nothing can open them again once the
  // prospect is gone, but leaving them would keep un-sendable notes in memory
  // for the rest of the session.
  delete store.notesByProspect[prospectId];
  emitProspects();
  return true;
}

// Change fields on a prospect that is still sitting in this queue, unsent, by
// editing the queued row itself instead of queueing a change to it.
//
// This exists because the obvious alternative is wrong. A prospect added ten
// minutes ago has no row on the server, so an ordinary update aimed at it has
// nothing to find, correcting a name you'd just mistyped would fail, and keep
// failing, until the original insert happened to go out. Folding the correction
// into the insert means only the corrected version is ever sent, which is also
// what somebody fixing a typo thirty seconds later plainly meant.
//
// Returns true if it handled it, so callers know whether they still need the
// server.
export function patchPendingProspect(prospectId, patch) {
  const job = queue.find((j) => j.kind === "prospect-insert" && j.prospectId === prospectId);
  if (!job) return false;
  Object.assign(job.row, patch);
  save();
  emitProspects();
  return true;
}

// Change one or more fields on a prospect. Takes effect on screen straight
// away and is sent as soon as there's a connection.
//
// Repeated calls for the same prospect MERGE into the one queued job rather
// than stacking up. Somebody who taps through Not contacted -> Sent -> Replied
// while out of signal should send one write saying "Replied", not three writes
// replaying a sequence that no longer means anything. Merging also means the
// queue can't grow without bound while somebody fiddles with a dropdown.
export function patchProspect(prospectId, patch) {
  // Not sent yet, so fold the change into the row that's about to be sent
  // rather than queueing a second job to change it a moment later.
  if (patchPendingProspect(prospectId, patch)) return Promise.resolve();

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

// Post a note. The id is made here rather than by the database, see the
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

// Tick a daily mission on or off.
//
// completedAt is stamped now, when the box was tapped, rather than left for
// the server to fill in when the message finally gets out. A mission finished
// at three in the afternoon in Mbare should not be recorded as six in the
// evening just because that's when the phone found a signal. workDate is
// captured here for the same reason: something ticked late on Monday belongs
// to Monday even if it sends on Tuesday.
//
// Merged per mission per day, like the prospect patches, somebody tapping a
// box on and off while they decide should send one final answer, not a replay
// of them changing their mind.
export function setTaskCompletion(taskId, completed) {
  const agentId = store.profile?.id || null;
  const workDate = new Date().toISOString().slice(0, 10);
  const completedAt = completed ? new Date().toISOString() : null;

  const existing = queue.find(
    (j) => j.kind === "task-completion" && j.taskId === taskId && j.workDate === workDate && j.agentId === agentId
  );
  if (existing) {
    existing.completed = completed;
    existing.completedAt = completedAt;
    existing.at = Date.now();
  } else {
    queue.push({ id: newId(), kind: "task-completion", taskId, agentId, workDate, completed, completedAt, at: Date.now() });
  }
  save();
  emitDailyCompletions();
  return flushOutbox();
}

// ---- keeping un-sent edits on screen ---------------------------------------
//
// Every few seconds something replaces store.prospects or a prospect's notes
// with a fresh copy from the server: the periodic resync, a teammate's live
// update, coming back to the app from the lock screen. That server copy does
// not contain anything still sitting in this queue, so without these two the
// status you just set would appear, then silently revert to the old one the
// next time anything refreshed, which looks exactly like the app losing your
// work, and is the failure people would trust least.
//
// state.js calls both of these on every such refresh (see setOutboxDecorators
// at the bottom of this file).

function decorateProspects(list) {
  if (!list) return;

  // Throw away the placeholders this added last time and rebuild them from the
  // queue below. Rebuilding rather than patching in place is what stops a shop
  // being drawn twice the moment it lands for real: once the server's own copy
  // is in the list, the insert job finds it there and adds nothing. It also
  // runs when the queue is empty, which is exactly the case where the last one
  // just went out and its placeholder needs clearing.
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]._pending) list.splice(i, 1);
  }
  if (!queue.length) return;

  // Walked in queue order so that a status set straight after adding a shop is
  // applied to the placeholder the job before it just put back on screen.
  queue.forEach((job) => {
    if (job.kind === "prospect-insert") {
      if (list.some((x) => x.id === job.prospectId)) return;
      // Read by the pipeline card and the detail sheet to mark this as still
      // on its way. Prefixed to make it obvious it isn't a column on prospects.
      list.push({ ...job.row, _pending: true });
      return;
    }
    if (job.kind === "prospect-patch") {
      const p = list.find((x) => x.id === job.prospectId);
      if (p) Object.assign(p, job.patch);
    }
  });
}

function decorateNotes(prospectId, list) {
  if (!list) return;

  // Drop any still-sending note whose job has since left the queue. Without
  // this the placeholder would sit there wearing "Sending…" forever after the
  // real note was saved, on any screen that didn't happen to refetch. Note
  // this runs even when the queue is empty, that IS the case where the last
  // note just went out and its placeholder needs clearing.
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]._pending && !queue.some((j) => j.id === list[i].id)) list.splice(i, 1);
  }
  if (!queue.length) return;

  queue.forEach((job) => {
    if (job.kind !== "note" || job.prospectId !== prospectId) return;
    // Already arrived (the note went out, and this refresh is the server's
    // own copy of it coming back), the queue just hasn't been trimmed yet.
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

// Simpler than the notes one, because a completion row has a natural key, // (mission, person, date), so a queued tick can always find the row it
// belongs to instead of needing an id matched up. Every placeholder this
// added last time is thrown away first and rebuilt from the queue, which is
// what keeps it correct once the real row arrives: at that point the queued
// tick patches the real row and no placeholder gets re-added, so the mission
// never appears twice.
function decorateCompletions(list) {
  if (!list) return;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]._pending) list.splice(i, 1);
  }
  if (!queue.length) return;

  queue.forEach((job) => {
    if (job.kind !== "task-completion") return;
    const row = list.find(
      (c) => c.task_id === job.taskId && c.agent_id === job.agentId && c.work_date === job.workDate
    );
    if (row) {
      row.completed = job.completed;
      row.completed_at = job.completedAt;
      return;
    }
    list.push({
      id: "pending-" + job.id,
      task_id: job.taskId,
      agent_id: job.agentId,
      work_date: job.workDate,
      completed: job.completed,
      completed_at: job.completedAt,
      _pending: true,
    });
  });
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
  if (job.kind === "prospect-insert") {
    // org_id is left out on purpose, the stamp_org_id trigger fills it in.
    // _pending is a marker this file invented; it is not a column, and sending
    // it would be rejected.
    const { _pending, ...row } = job.row;
    const { error } = await sb.from("prospects").insert(row);
    // Already there from an attempt whose reply got lost. Not an error, and
    // importantly not a reason to skip the follow-up work below.
    if (error && error.code !== "23505") return error;

    // Both of these need a connection, which is why they wait until now rather
    // than firing when the form was submitted. Neither is allowed to fail the
    // job: the prospect is saved, and losing a push notification or an AI
    // message is not worth re-sending a row that is already in the table.
    //
    // They run on the duplicate-key path too, and that is not an oversight. A
    // lost reply means this file returned a transient error last time and never
    // got here, so the row landed but the team was never told about it. This
    // attempt is the first chance to do that.
    notify("new_prospect", job.prospectId);
    if (job.wantsResearch) {
      sb.functions
        .invoke("research-prospect", { body: { prospect_id: job.prospectId } })
        .catch((err) => console.error("research-prospect invoke failed", err));
    }
    return null;
  }
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
  if (job.kind === "task-completion") {
    // The same upsert tasks.js has always used. org_id is left out on purpose
    //, a database trigger (stamp_org_id) fills it in, so sending one from
    // here would be duplicating a decision the server already makes.
    const { error } = await sb.from("daily_task_completions").upsert(
      {
        task_id: job.taskId,
        agent_id: job.agentId,
        work_date: job.workDate,
        completed: job.completed,
        completed_at: job.completedAt,
      },
      { onConflict: "task_id,agent_id,work_date" }
    );
    return error;
  }
  return null; // Unknown kind (an older/newer version of this file wrote it), drop it.
}

// Sends everything waiting, oldest first, and stops at the first job that
// couldn't get through.
//
// Stopping rather than skipping ahead is deliberate. If the connection died on
// job 1 it has almost certainly died for job 2 as well, so carrying on would
// just be a burst of doomed requests. More importantly, order is meaning here:
// a status change must not arrive before the prospect it applies to exists, and
// a note explaining that status change should not arrive before it either.
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
  let touchedCompletions = false;
  let inserted = false;
  const rejected = new Set();

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
        rejected.add(job.kind);
        const { toast } = await import("./utils.js");

        if (job.kind === "prospect-insert") {
          // Everything queued behind this one hangs off a prospect that is now
          // never going to exist, so each would fail on arrival and fire its
          // own error. Drop them together and say it once, naming the business
          //, "couldn't save one change" is no use when what was actually lost
          // is a shop you wrote down an hour ago and can no longer remember.
          const name = job.row.business_name || "that prospect";
          queue = queue.filter((j) => j.prospectId !== job.prospectId);
          save();
          toast(`Couldn't add ${name}: ${error.message}`, "error");
          touchedProspects.add(job.prospectId);
          continue;
        }

        toast(`Couldn't save one change: ${error.message}`, "error");
      }

      if (job.kind === "prospect-insert") inserted = true;
      if (job.kind === "prospect-patch") touchedProspects.add(job.prospectId);
      if (job.kind === "note") touchedNotes.add(job.prospectId);
      if (job.kind === "task-completion") touchedCompletions = true;
      queue.shift();
      save();
    }
  } finally {
    flushing = false;
  }

  // Re-render whatever the queue was propping up. Without this, a note that
  // has now genuinely been saved would keep its "Sending…" mark until the
  // next unrelated refresh happened to come along.
  //
  // A prospect that has just been added needs a refetch rather than a re-render,
  // and this is the one place where the difference is visible. Its placeholder
  // was the ONLY copy on this phone, so simply re-rendering would prune it and
  // leave nothing behind, and the shop somebody added ten minutes ago would
  // disappear off the pipeline at the exact moment it was successfully saved.
  // Fetching first and rendering once means the placeholder is quietly replaced
  // by the real row instead of blinking out and back.
  if (inserted) await refreshProspects();
  else if (touchedProspects.size) emitProspects();
  touchedNotes.forEach((pid) => emitNotes(pid));
  if (touchedCompletions) emitDailyCompletions();

  // Something was refused outright. The screen is currently showing a value
  // that this device believes and the server never accepted, and nothing else
  // is going to correct it, the job is gone from the queue, so the decorators
  // won't be re-applying it either. Pull the truth back down so the screen
  // stops claiming a change that didn't happen. (Notes and refused new
  // prospects need no equivalent: there was never a server row behind either
  // of them, so pruning the placeholder, which the re-render above already
  // did, leaves the screen honest with nothing to fetch.)
  if (rejected.has("prospect-patch")) refreshProspects();
  if (rejected.has("task-completion")) refreshDailyCompletions();

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
  setOutboxDecorators({ prospects: decorateProspects, notes: decorateNotes, completions: decorateCompletions });

  window.addEventListener("online", () => flushOutbox());

  // Coming back to the app is the single best moment to try: it is usually the
  // moment someone has walked back into signal, or into the office, and it
  // costs nothing when there's nothing waiting.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") flushOutbox();
  });

  // Anything left over from a previous session, the app was closed with edits
  // still unsent, and this is the first chance to deliver them.
  flushOutbox();
}
