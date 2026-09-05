import { sb } from "./supabaseClient.js";
import { store, emit } from "./state.js";
import { toast } from "./utils.js";

let mode = "signin"; // or "signup"
let agencyMode = "create"; // or "join" — only meaningful when mode === "signup"

const els = () => ({
  screen: document.getElementById("auth-screen"),
  name: document.getElementById("auth-name"),
  email: document.getElementById("auth-email"),
  password: document.getElementById("auth-password"),
  submit: document.getElementById("auth-submit"),
  loading: document.getElementById("auth-loading"),
  error: document.getElementById("auth-error"),
  toggle: document.getElementById("auth-mode-toggle"),
  hint: document.getElementById("auth-mode-hint"),
  nameField: document.getElementById("auth-name")?.closest(".field"),
  agencyModeRow: document.getElementById("auth-agency-mode-row"),
  agencyCreateTab: document.getElementById("auth-agency-create-tab"),
  agencyJoinTab: document.getElementById("auth-agency-join-tab"),
  agencyNameField: document.getElementById("auth-agency-name-field"),
  agencyName: document.getElementById("auth-agency-name"),
  inviteCodeField: document.getElementById("auth-invite-code-field"),
  inviteCode: document.getElementById("auth-invite-code"),
  benefits: document.getElementById("auth-benefits"),
  terms: document.getElementById("auth-terms"),
});

function setAgencyMode(next) {
  agencyMode = next;
  const e = els();
  e.agencyCreateTab.classList.toggle("active", agencyMode === "create");
  e.agencyJoinTab.classList.toggle("active", agencyMode === "join");
  e.agencyNameField.style.display = agencyMode === "create" ? "" : "none";
  e.inviteCodeField.style.display = agencyMode === "join" ? "" : "none";
}

function setMode(next) {
  mode = next;
  const e = els();
  if (mode === "signup") {
    e.submit.textContent = "Create Account";
    e.hint.textContent = "Already on the team?";
    e.toggle.textContent = "Sign in";
    e.nameField.style.display = "";
    e.agencyModeRow.style.display = "";
    e.benefits.style.display = "";
    e.terms.style.display = "";
    setAgencyMode(agencyMode);
  } else {
    e.submit.textContent = "Sign In";
    e.hint.textContent = "New to Agency Command?";
    e.toggle.textContent = "Create account";
    e.nameField.style.display = "none";
    e.agencyModeRow.style.display = "none";
    e.agencyNameField.style.display = "none";
    e.inviteCodeField.style.display = "none";
    e.benefits.style.display = "none";
    e.terms.style.display = "none";
  }
  e.error.style.display = "none";
}

function showError(msg) {
  const e = els();
  e.error.textContent = msg;
  e.error.style.display = "block";
}

async function handleSubmit() {
  const e = els();
  const email = e.email.value.trim();
  const password = e.password.value;
  const name = e.name.value.trim();
  const agencyName = e.agencyName.value.trim();
  const inviteCode = e.inviteCode.value.trim();

  if (!email || !password) return showError("Enter your email and password.");
  if (mode === "signup" && password.length < 6) return showError("Password must be at least 6 characters.");
  if (mode === "signup" && !name) return showError("Enter your name so your team recognises you.");
  if (mode === "signup" && agencyMode === "create" && !agencyName) return showError("Enter a name for your agency.");
  if (mode === "signup" && agencyMode === "join" && !inviteCode) return showError("Enter the invite code your team owner shared with you.");

  e.submit.disabled = true;
  e.loading.style.display = "block";
  e.error.style.display = "none";

  try {
    if (mode === "signup") {
      // Set *before* calling signUp() rather than after: Supabase's
      // SIGNED_IN event (which main.js listens for to boot the app) can
      // fire as a side effect of this call, sometimes before the outer
      // await here even resolves. Flag has to already be in place by then
      // or main.js's enterApp() would miss the moment. Cleared below on
      // failure so a rejected signup attempt can't wrongly trigger the
      // wizard on some later, unrelated sign-in.
      sessionStorage.setItem("sxc_just_signed_up", "1");
      const { error } = await sb.auth.signUp({
        email, password,
        options: {
          data: {
            full_name: name,
            agency_mode: agencyMode,
            agency_name: agencyName,
            invite_code: inviteCode,
          },
        },
      });
      if (error) { sessionStorage.removeItem("sxc_just_signed_up"); throw error; }
      toast("Account created, you're in!", "success");
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (err) {
    showError(err.message || "Something went wrong. Try again.");
  } finally {
    e.submit.disabled = false;
    e.loading.style.display = "none";
  }
}

export function initAuthScreen() {
  const e = els();
  setMode("signin");
  e.toggle.addEventListener("click", () => setMode(mode === "signin" ? "signup" : "signin"));
  e.agencyCreateTab.addEventListener("click", () => setAgencyMode("create"));
  e.agencyJoinTab.addEventListener("click", () => setAgencyMode("join"));
  e.submit.addEventListener("click", handleSubmit);
  [e.email, e.password, e.name, e.agencyName, e.inviteCode].forEach((input) =>
    input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") handleSubmit(); })
  );
}

export async function loadOwnProfile(userId) {
  const { data } = await sb.from("profiles").select("*").eq("id", userId).maybeSingle();
  store.profile = data;
  emit("profile");
  return data;
}

export async function signOut() {
  await sb.auth.signOut();
}
