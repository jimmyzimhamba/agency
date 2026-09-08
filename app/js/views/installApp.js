// "Get the App", lets a team member install Agency Command as a real app
// (home-screen icon, full-screen, works offline) instead of using it as a
// bookmarked browser tab. Captures Chrome/Android/Desktop's native install
// prompt when available, and falls back to plain-English steps for iOS
// Safari (which has no install API) and any browser that hasn't fired the
// prompt yet.

import { el } from "../utils.js";
import { openSheet, closeSheet } from "../ui.js";

let deferredPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
});

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function openInstallAppSheet() {
  const box = el(`<div></div>`);

  if (isStandalone()) {
    box.innerHTML = `
      <div class="empty-state">
        <p>✅ You're already using the installed app on this device.</p>
      </div>`;
    openSheet("Get the App", box);
    return;
  }

  if (deferredPrompt) {
    box.innerHTML = `
      <div class="hint" style="margin-bottom:14px;line-height:1.5;">
        Install Agency Command on this device for one-tap access, a real app icon, and full-screen use, no browser bar, works offline.
      </div>
      <button class="btn btn-primary" id="install-now" style="width:100%;">Install App</button>
    `;
    openSheet("Get the App", box);
    box.querySelector("#install-now").addEventListener("click", async () => {
      const promptEvent = deferredPrompt;
      if (!promptEvent) return;
      deferredPrompt = null;
      closeSheet();
      promptEvent.prompt();
      await promptEvent.userChoice;
    });
    return;
  }

  if (isIOS()) {
    box.innerHTML = `
      <div class="hint" style="margin-bottom:10px;">On iPhone / iPad (Safari):</div>
      <ol style="padding-left:18px;line-height:1.8;font-size:13.5px;color:var(--text-dim);margin:0;">
        <li>Tap the <strong>Share</strong> icon (square with an arrow up) in Safari's toolbar.</li>
        <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
        <li>Tap <strong>Add</strong> in the top right.</li>
      </ol>
      <div class="hint" style="margin-top:14px;">The Agency Command icon will then sit on your home screen like any other app, full screen, no Safari bar.</div>
    `;
    openSheet("Get the App", box);
    return;
  }

  box.innerHTML = `
    <div class="hint" style="margin-bottom:10px;">On Android (Chrome):</div>
    <ol style="padding-left:18px;line-height:1.8;font-size:13.5px;color:var(--text-dim);margin:0;">
      <li>Tap the <strong>⋮</strong> menu in the top right.</li>
      <li>Tap <strong>Add to Home screen</strong> (or <strong>Install app</strong>).</li>
    </ol>
    <div class="hint" style="margin:14px 0 10px;">On Desktop (Chrome / Edge):</div>
    <ol style="padding-left:18px;line-height:1.8;font-size:13.5px;color:var(--text-dim);margin:0;">
      <li>Click the install icon in the address bar (or the <strong>⋮</strong> menu).</li>
      <li>Choose <strong>Install Agency Command</strong>.</li>
    </ol>
  `;
  openSheet("Get the App", box);
}
