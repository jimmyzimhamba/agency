import { store } from "../state.js";
import { el, esc, toast } from "../utils.js";
import { openModal, closeModal } from "../ui.js";
import { AVATAR_PRESETS, dicebearUrl, saveAvatarUrl } from "./team.js";

// Shown exactly once, right after a brand-new sign-up, never on an
// ordinary sign-in, and never again after the first time. Triggered by a
// one-shot sessionStorage flag set in auth.js's handleSubmit right before
// the signUp() call, and consumed in main.js's enterApp() once the new
// account's data has finished loading. sessionStorage (not localStorage) is
// deliberate: this only ever needs to survive the redirect from "just
// signed up" to "app finished booting" within the same tab, not persist
// across future visits, a stray leftover flag from a previous browser
// session should never be able to re-trigger this.
//
// Deliberately short, two or three steps, not the sprawling multi-screen
// wizard this was inspired by (which also walked through connecting a
// Chrome extension and buying credits, neither of which exists in this
// free, WhatsApp-first product). Everything a new team actually needs to
// *do*, add a prospect, send a contract, etc., is already covered by the
// Dashboard's "Getting Started" checklist card, so this wizard doesn't try
// to repeat that list. It's about making the workspace feel like theirs
// (an avatar) and, for whoever just created the agency, putting the invite
// code in front of them before they forget it exists, not about tasks.
export function openOnboardingWizard() {
  const isOwner = store.profile?.role === "owner";
  const firstName = (store.profile?.full_name || "").trim().split(/\s+/)[0] || "there";

  // Only the person who *created* the agency gets the "invite your team"
  // step, someone who joined via an invite code is already a member of a
  // team that presumably has an owner handling invites, and non-owners
  // can't regenerate the code anyway (see team.js), so showing it here
  // would just be a step with nothing new to do.
  const steps = ["welcome", ...(isOwner ? ["invite"] : []), "done"];
  let stepIndex = 0;

  const box = el(`
    <div>
      <div class="flex-between" style="margin-bottom:14px;">
        <div class="progress-track" style="flex:1;margin-right:14px;"><div class="progress-fill" id="ob-progress"></div></div>
        <span class="small-link" id="ob-skip">Skip</span>
      </div>
      <div id="ob-step-body"></div>
      <div style="display:flex;gap:10px;margin-top:20px;">
        <button class="btn btn-ghost" id="ob-back" style="display:none;">Back</button>
        <button class="btn btn-primary" id="ob-next">Next</button>
      </div>
    </div>
  `);

  const body = box.querySelector("#ob-step-body");
  const backBtn = box.querySelector("#ob-back");
  const nextBtn = box.querySelector("#ob-next");
  const progressFill = box.querySelector("#ob-progress");

  function renderStep() {
    const name = steps[stepIndex];
    progressFill.style.width = `${Math.round(((stepIndex + 1) / steps.length) * 100)}%`;
    backBtn.style.display = stepIndex > 0 ? "" : "none";
    nextBtn.textContent = stepIndex === steps.length - 1 ? "Let's go" : "Next";

    if (name === "welcome") {
      body.innerHTML = `
        <div style="font-weight:800;font-size:17px;margin-bottom:4px;">Welcome, ${esc(firstName)}! 👋</div>
        <div class="text-faint" style="font-size:13px;line-height:1.5;margin-bottom:16px;">Let's make this workspace yours: pick an avatar below (or skip and do it later from Team).</div>
        <div id="ob-avatar-grid" style="display:flex;flex-wrap:wrap;gap:9px;"></div>
      `;
      const grid = body.querySelector("#ob-avatar-grid");
      AVATAR_PRESETS.forEach((seed) => {
        const url = dicebearUrl(seed);
        const thumb = el(`<div class="avatar-preset" title="${esc(seed)}"><img src="${url}" alt="" loading="lazy" /></div>`);
        if (store.profile?.avatar_url === url) thumb.classList.add("selected");
        thumb.addEventListener("click", async () => {
          grid.querySelectorAll(".avatar-preset").forEach((t) => t.classList.remove("selected"));
          thumb.classList.add("selected");
          await saveAvatarUrl(url);
        });
        grid.appendChild(thumb);
      });
    } else if (name === "invite") {
      body.innerHTML = `
        <div style="font-weight:800;font-size:17px;margin-bottom:4px;">Invite your team</div>
        <div class="text-faint" style="font-size:13px;line-height:1.5;margin-bottom:14px;">Share this code with teammates: they'll land straight in ${esc(store.organization?.name || "your agency")} when they sign up. You can find it again any time under Team.</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <code style="flex:1;background:var(--black-card);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px;letter-spacing:0.5px;">${esc(store.organization?.invite_code || "-")}</code>
          <button class="btn btn-ghost btn-sm" id="ob-copy-invite" style="width:auto;">Copy</button>
        </div>
      `;
      body.querySelector("#ob-copy-invite").addEventListener("click", async () => {
        const code = store.organization?.invite_code;
        if (!code) return;
        try {
          await navigator.clipboard.writeText(code);
          toast("Invite code copied", "success");
        } catch {
          toast("Couldn't copy, long-press the code to select it", "error");
        }
      });
    } else {
      body.innerHTML = `
        <div style="text-align:center;padding:8px 0 4px;">
          <div style="font-size:38px;margin-bottom:10px;">🎉</div>
          <div style="font-weight:800;font-size:17px;margin-bottom:6px;">You're all set</div>
          <div class="text-faint" style="font-size:13px;line-height:1.5;">Head to the Dashboard for a quick checklist of what to do next: add a prospect, reach out, and the rest follows.</div>
        </div>
      `;
    }
  }

  backBtn.addEventListener("click", () => {
    stepIndex = Math.max(0, stepIndex - 1);
    renderStep();
  });
  nextBtn.addEventListener("click", () => {
    if (stepIndex === steps.length - 1) { closeModal(); return; }
    stepIndex++;
    renderStep();
  });
  box.querySelector("#ob-skip").addEventListener("click", () => closeModal());

  renderStep();
  openModal(box);
}
