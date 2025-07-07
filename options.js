/* global chrome */

const form                = document.getElementById("options-form");
const siteListEl          = document.getElementById("site-list");
const modeSelectEl        = document.getElementById("blacklist-or-whitelist");
const showNotificationsEl = document.getElementById("show-notifications");
const shouldRingEl        = document.getElementById("should-ring");
const clickRestartsEl     = document.getElementById("click-restarts");
const saveOkEl            = document.getElementById("save-successful");
const timeErrEl           = document.getElementById("time-format-error");
const workDurEl           = document.getElementById("work-duration");
const breakDurEl          = document.getElementById("break-duration");
const TIME_REGEX          = /^([0-9]+)(:([0-9]{2}))?$/;
const stopButton          = document.getElementById("stop-timer");

/* ───── i18n ───── */
document
  .querySelectorAll("[data-i18n]")
  .forEach((el) => {
    let msg = chrome.i18n.getMessage(el.dataset.i18n);
    if (el.hasAttribute("data-i18n-caps"))
      msg = msg.charAt(0).toUpperCase() + msg.slice(1);
    el.textContent = msg;
  });

/* ───── load prefs ───── */
chrome.storage.local.get(["prefs", "currentMode"], ({ prefs, currentMode }) => {
  if (!prefs) return; // 初回は Service Worker が保存

  siteListEl.value          = prefs.siteList.join("\n");
  modeSelectEl.selectedIndex = prefs.whitelist ? 1 : 0;
  showNotificationsEl.checked = prefs.showNotifications;
  shouldRingEl.checked      = prefs.shouldRing;
  clickRestartsEl.checked   = prefs.clickRestarts;
  workDurEl.value           = prefs.durations.work  / 60;
  breakDurEl.value          = prefs.durations.break / 60;

  updateDisabled(currentMode);
});

/* ───── form submit ───── */
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const durations = {};
  for (const [key, el] of Object.entries({ work: workDurEl, break: breakDurEl })) {
    const m = el.value.match(TIME_REGEX);
    if (!m) return timeErrEl.classList.add("show");

    durations[key] =
      parseInt(m[1], 10) * 60 + (m[3] ? parseInt(m[3], 10) : 0);
  }

  const prefs = {
    siteList: siteListEl.value.split(/\r?\n/),
    durations,
    showNotifications: showNotificationsEl.checked,
    shouldRing: shouldRingEl.checked,
    clickRestarts: clickRestartsEl.checked,
    whitelist: modeSelectEl.selectedIndex === 1
  };

  chrome.runtime.sendMessage({ type: "setPrefs", payload: prefs }, () => {
    saveOkEl.classList.add("show");
  });
});

/* ───── stop button click listener ───── */
stopButton.addEventListener("click", () => {
  if (confirm("Are you sure to stop?")) {
    chrome.runtime.sendMessage({ type: "stopTimer" });
  }
});

/* ───── storage change listener ───── */
chrome.storage.onChanged.addListener((chg, area) => {
  if (area === "local" && chg.currentMode) {
    updateDisabled(chg.currentMode.newValue);
  }
});

/* ───── helpers ───── */
function updateDisabled(mode) {
  const disabled = false; // Always allow settings to be changed
  [
    siteListEl, modeSelectEl, workDurEl,
    breakDurEl, showNotificationsEl, shouldRingEl, clickRestartsEl
  ].forEach((el) => (el.disabled = disabled));

  document.body.className = mode === "work" ? "work" : "";
}

["input", "change"].forEach((ev) =>
  form.addEventListener(ev, () => {
    saveOkEl.classList.remove("show");
    timeErrEl.classList.remove("show");
  })
);
