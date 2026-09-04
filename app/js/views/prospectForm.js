import { sb } from "../supabaseClient.js";
import { store, knownCities } from "../state.js";
import { el, esc, toast, personalizeMessage, titleCase, statusLabel, findDuplicateProspect } from "../utils.js";
import { closeSheet, confirmModal } from "../ui.js";
import { notify } from "../push.js";

const TEMPLATE_CAT_LABELS = { opener: "Opener", follow_up: "Follow-up", objection: "Objection Handler", close: "Close" };

// Shared add/edit form for a prospect. Used by the pipeline "+" button and
// by the prospect detail sheet's "Edit" button.
export function buildProspectForm(existing, onSaved) {
  const p = existing || {};
  const nicheOptions = store.niches
    .map((n) => `<option value="${n.id}" ${p.niche_id === n.id ? "selected" : ""}>${esc(n.name)}</option>`)
    .join("");

  const templateOptions = ["opener", "follow_up", "objection", "close"]
    .map((cat) => {
      const items = store.templates.filter((t) => t.category === cat);
      if (!items.length) return "";
      const opts = items
        .map((t) => `<option value="${t.id}">${esc(t.title)}${t.niche_id ? "" : " (General)"}</option>`)
        .join("");
      return `<optgroup label="${TEMPLATE_CAT_LABELS[cat]}">${opts}</optgroup>`;
    })
    .join("");

  const wrap = el(`
    <div>
      <div class="field">
        <label>Business name *</label>
        <input id="pf-name" type="text" value="${esc(p.business_name || "")}" placeholder="The Fig & Olive" />
      </div>
      <div class="field-row">
        <div class="field">
          <label>Niche</label>
          <select id="pf-niche"><option value="">Select niche</option>${nicheOptions}</select>
        </div>
        <div class="field">
          <label>City</label>
          <input id="pf-city" type="text" list="pf-city-list" value="${esc(p.city || (existing ? "" : "Harare"))}" placeholder="Harare" />
          <datalist id="pf-city-list">${knownCities().map((c) => `<option value="${esc(c)}"></option>`).join("")}</datalist>
        </div>
      </div>
      <div class="field">
        <label>Area</label>
        <input id="pf-area" type="text" value="${esc(p.area || "")}" placeholder="Borrowdale" />
      </div>
      <div class="field-row">
        <div class="field">
          <label>WhatsApp number</label>
          <input id="pf-whatsapp" type="text" value="${esc(p.whatsapp_number || "")}" placeholder="0771 234 567" />
        </div>
        <div class="field">
          <label>Rating</label>
          <input id="pf-rating" type="number" step="0.1" min="0" max="5" value="${p.rating ?? ""}" placeholder="4.5" />
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Email</label>
          <input id="pf-email" type="email" value="${esc(p.email || "")}" placeholder="hello@business.co.zw" />
        </div>
        <div class="field">
          <label>Instagram</label>
          <input id="pf-instagram" type="text" value="${esc(p.instagram || "")}" placeholder="@handle" />
        </div>
      </div>
      <div class="field">
        <label>Website</label>
        <input id="pf-website" type="text" value="${esc(p.website || "")}" placeholder="www.business.co.zw" />
      </div>
      <div class="field">
        <label>Gap / observation</label>
        <textarea id="pf-gap" placeholder="No posts in 3 months, no bio link...">${esc(p.gap_note || "")}</textarea>
      </div>
      <div class="field">
        <label>Outreach message</label>
        ${templateOptions ? `
          <select id="pf-template-pick" style="margin-bottom:8px;">
            <option value="">Insert a template...</option>
            ${templateOptions}
          </select>
        ` : ""}
        <textarea id="pf-message" placeholder="${existing ? "" : "Leave blank to auto-research this business and write it for you"}">${esc(p.outreach_message || "")}</textarea>
        <div class="hint">${existing
          ? `Niche templates auto-fill using the business name, area, and gap note above. If you see <code>{{agent_name}}</code> in the text, leave it — it turns into whoever's sending automatically.`
          : `Leave this blank and Agency Command will research the business online and write a ready-to-send message for you (takes about a minute). Type your own message here instead to skip auto-research.`}</div>
      </div>
      ${!existing ? `
        <div class="field">
          ${store.profile?.role === "owner" ? `
            <label>Assign to</label>
            <select id="pf-assign">
              <option value="">Unassigned</option>
              ${store.profiles
                .filter((pr) => pr.active !== false)
                .sort((a, b) => (a.full_name || a.email || "").localeCompare(b.full_name || b.email || ""))
                .map((pr) => `<option value="${pr.id}">${esc(pr.full_name || pr.email)}</option>`)
                .join("")}
            </select>
          ` : `
            <label style="display:flex;align-items:center;gap:8px;font-weight:400;">
              <input type="checkbox" id="pf-assign-me" style="width:auto;" /> Assign this prospect to me
            </label>
          `}
        </div>
      ` : ""}
      <div class="field-row">
        <div class="field">
          <label>Tier</label>
          <select id="pf-tier">
            <option value="A" ${p.tier === "A" ? "selected" : ""}>A — Priority</option>
            <option value="B" ${!p.tier || p.tier === "B" ? "selected" : ""}>B — Standard</option>
            <option value="C" ${p.tier === "C" ? "selected" : ""}>C — Low priority</option>
          </select>
        </div>
        <div class="field">
          <label>Heat score (0-100)</label>
          <input id="pf-heat" type="number" min="0" max="100" value="${p.heat_score ?? 50}" />
        </div>
      </div>
      <div class="field">
        <label>Follow-up date</label>
        <input id="pf-followup" type="date" value="${p.follow_up_date || ""}" />
      </div>
      <div class="field">
        <label>Monthly retainer value (if signed)</label>
        <input id="pf-mrr" type="number" min="0" step="1" value="${p.mrr || ""}" placeholder="e.g. 250" />
      </div>
      <button id="pf-save" class="btn btn-primary" style="margin-top:6px;">${existing ? "Save Changes" : "Add Prospect"}</button>
    </div>
  `);

  const templatePick = wrap.querySelector("#pf-template-pick");
  if (templatePick) {
    templatePick.addEventListener("change", () => {
      const id = templatePick.value;
      templatePick.value = "";
      if (!id) return;
      const t = store.templates.find((x) => x.id === id);
      if (!t) return;
      const liveProspect = {
        business_name: wrap.querySelector("#pf-name").value.trim(),
        area: wrap.querySelector("#pf-area").value.trim(),
        gap_note: wrap.querySelector("#pf-gap").value.trim(),
      };
      const agentFirst = store.profile?.full_name?.split(" ")[0];
      wrap.querySelector("#pf-message").value = personalizeMessage(t.body, liveProspect, agentFirst);
    });
  }

  wrap.querySelector("#pf-save").addEventListener("click", async () => {
    const name = wrap.querySelector("#pf-name").value.trim();
    if (!name) return toast("Business name is required", "error");

    const payload = {
      business_name: name,
      niche_id: wrap.querySelector("#pf-niche").value || null,
      city: titleCase(wrap.querySelector("#pf-city").value) || "Harare",
      area: wrap.querySelector("#pf-area").value.trim(),
      whatsapp_number: wrap.querySelector("#pf-whatsapp").value.trim(),
      rating: wrap.querySelector("#pf-rating").value ? Number(wrap.querySelector("#pf-rating").value) : null,
      email: wrap.querySelector("#pf-email").value.trim(),
      instagram: wrap.querySelector("#pf-instagram").value.trim(),
      website: wrap.querySelector("#pf-website").value.trim(),
      gap_note: wrap.querySelector("#pf-gap").value.trim(),
      outreach_message: wrap.querySelector("#pf-message").value.trim(),
      tier: wrap.querySelector("#pf-tier").value,
      heat_score: Number(wrap.querySelector("#pf-heat").value) || 0,
      follow_up_date: wrap.querySelector("#pf-followup").value || null,
      mrr: Number(wrap.querySelector("#pf-mrr").value) || 0,
    };

    const btn = wrap.querySelector("#pf-save");

    const doSave = async () => {
      btn.disabled = true;

      if (existing) {
        const { error } = await sb.from("prospects").update(payload).eq("id", existing.id);
        btn.disabled = false;
        if (error) return toast(error.message, "error");
        toast("Saved", "success");
      } else {
        payload.created_by = store.profile.id;
        const assignSel = wrap.querySelector("#pf-assign");
        const assignMe = wrap.querySelector("#pf-assign-me");
        if (assignSel) payload.assigned_to = assignSel.value || null;
        else if (assignMe) payload.assigned_to = assignMe.checked ? store.profile.id : null;
        // A teammate typing their own message means "skip auto-research" —
        // only kick off AI research when the message box was left blank.
        const wantsResearch = !payload.outreach_message;
        if (wantsResearch) payload.research_status = "researching";

        const { data, error } = await sb.from("prospects").insert(payload).select().single();
        btn.disabled = false;
        if (error) return toast(error.message, "error");

        if (data?.id) notify("new_prospect", data.id);

        if (wantsResearch && data?.id) {
          toast("Prospect added — researching this business online...", "success");
          sb.functions.invoke("research-prospect", { body: { prospect_id: data.id } }).catch((err) => {
            console.error("research-prospect invoke failed", err);
          });
        } else {
          toast("Prospect added", "success");
        }
      }
      closeSheet();
      if (onSaved) onSaved();
    };

    // Only flag possible duplicates on brand-new prospects — editing an
    // existing one obviously matches itself, that's not a duplicate.
    if (!existing) {
      const dupe = findDuplicateProspect(name, payload.whatsapp_number, store.prospects);
      if (dupe) {
        const reasonText = dupe.reason === "phone" ? "the same WhatsApp number" : "a matching name";
        confirmModal({
          title: "Possible duplicate",
          body: `<b>${esc(dupe.prospect.business_name)}</b> is already in the pipeline (currently <b>${esc(statusLabel(dupe.prospect.status))}</b>) and matches on ${reasonText}. Add this one anyway?`,
          confirmLabel: "Add Anyway",
          onConfirm: doSave,
        });
        return;
      }
    }

    await doSave();
  });

  return wrap;
}
