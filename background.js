/* global chrome */

/*
  ────────────────────────────
  Preferences (async storage)
  ────────────────────────────
*/

function defaultPrefs() {
  return {
    siteList: [],
    durations: {          // 秒
      work:  25 * 60,
      break: 5  * 60
    },
    showNotifications: true,
    shouldRing:        true,
    clickRestarts:     false,
    whitelist:         false
  };
}

async function updatePrefsFormat(prefs) {
  if (prefs.domainBlacklist) {
    prefs.siteList = prefs.domainBlacklist;
    delete prefs.domainBlacklist;
  }
  if (!prefs.hasOwnProperty("showNotifications"))
    prefs.showNotifications = true;

  await chrome.storage.local.set({ prefs });
  return prefs;
}

async function loadPrefs() {
  const { prefs } = await chrome.storage.local.get("prefs");
  return prefs
    ? updatePrefsFormat(prefs)
    : (await chrome.storage.local.set({ prefs: defaultPrefs() }),
       defaultPrefs());
}

async function savePrefs(prefs) {
  await chrome.storage.local.set({ prefs });
  return prefs;
}

/*
  ────────────────────────────
  Icons
  ────────────────────────────
*/

const ICONS = {
  ACTION: { CURRENT: {}, PENDING: {} },
  FULL:   {}
};

// 実際のファイル構造に合わせて設定
ICONS.ACTION.CURRENT.work = "icons/work.png";
ICONS.ACTION.CURRENT.break = "icons/break.png";
ICONS.ACTION.PENDING.work = "icons/work_pending.png";
ICONS.ACTION.PENDING.break = "icons/break_pending.png";
ICONS.FULL.work = "icons/work_full.png";
ICONS.FULL.break = "icons/break_full.png";

/*
  ────────────────────────────
  Utility  (location match)
  ────────────────────────────
*/

function parseLocation(location) {
  const [domain, ...pathParts] = location.split("/");
  return { domain, path: pathParts.join("/") };
}

function pathsMatch(test, against) {
  return !against || test.startsWith(against);
}

function domainsMatch(test, against) {
  if (test === against) return true;
  const offset = test.length - against.length - 1;
  return offset >= 0 && test.slice(offset) === "." + against;
}

function locationsMatch(loc, pattern) {
  return (
    domainsMatch(loc.domain, pattern.domain) &&
    pathsMatch(loc.path, pattern.path)
  );
}

function isLocationBlocked(location, prefs) {
  for (const patternStr of prefs.siteList) {
    const pattern = parseLocation(patternStr);
    if (locationsMatch(location, pattern)) return !prefs.whitelist;
  }
  return prefs.whitelist;
}

async function executeInTabIfBlocked(action, tab, prefs) {
  if (!tab.url || tab.status === "unloaded") return;
  const loc = parseLocation(tab.url.split("://")[1]);
  if (isLocationBlocked(loc, prefs)) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: [`content_scripts/${action}.js`],
      });
    } catch (error) {
      console.warn(`Failed to execute script in tab ${tab.id}:`, error);
    }
  }
}

async function executeInAllBlockedTabs(action, prefs) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    await executeInTabIfBlocked(action, tab, prefs);
  }
}

/*
  ────────────────────────────
  Pomodoro model
  ────────────────────────────
*/

class PomodoroTimer {
  constructor(pomodoro, opts) {
    this.pomodoro = pomodoro;
    this.type      = opts.type;
    this.timeLeft  = opts.duration;
    this._onStart  = opts.onStart;
    this._onTick   = opts.onTick;
    this._onEnd    = opts.onEnd;
  }

  start() {
    this._onStart?.(this);
    this._onTick?.(this);
    this._interval = setInterval(() => this._tick(), 1000);
  }

  restart() {
    this.timeLeft = this.pomodoro.durations[this.type];
    this._onTick?.(this);
  }

  _tick() {
    this.timeLeft--;
    this._onTick?.(this);
    if (this.timeLeft <= 0) {
      clearInterval(this._interval);
      this._onEnd?.(this);
    }
  }

  timeStr() {
    return this.timeLeft >= 60
      ? Math.round(this.timeLeft / 60) + "m"
      : this.timeLeft + "s";
  }
}

class Pomodoro {
  constructor(prefs, callbacks) {
    this.prefs   = prefs;
    this.running = false;
    this.next    = "work";  // 次に開始するタイマーのタイプ
    this.prev    = null;    // 現在実行中または最後に実行したタイマーのタイプ
    this.cbs     = callbacks;
  }

  get durations() { return this.prefs.durations; }

  async start() {
    this.prev = this.next;
    this.next = this.prev === "work" ? "break" : "work";
    const type = this.prev;

    this.running = true;
    this.timer = new PomodoroTimer(this, {
      type,
      duration: this.durations[type],
      ...this.cbs
    });
    this.timer.start();
  }

  restart() {
    if (this.timer) this.timer.restart();
  }
}

/*
  ────────────────────────────
  Main logic
  ────────────────────────────
*/

(async () => {
  const PREFS = await loadPrefs();

  const pomodoro = new Pomodoro(PREFS, {
    onStart: async (timer) => {
      console.log(`Starting ${timer.type} timer`);
      await chrome.action.setIcon({ path: ICONS.ACTION.CURRENT[timer.type] });
      await chrome.action.setBadgeBackgroundColor({
        color: timer.type === "work" ? [192, 0, 0, 255] : [0, 192, 0, 255]
      });
      await chrome.storage.local.set({ currentMode: timer.type });
      await executeInAllBlockedTabs(
        timer.type === "work" ? "block" : "unblock",
        PREFS
      );
    },

    onTick: async (timer) => {
      await chrome.action.setBadgeText({ text: timer.timeStr() });
    },

    onEnd: async (timer) => {
      console.log(`${timer.type} timer ended, next: ${pomodoro.next}`);
      await chrome.action.setIcon({
        path: ICONS.ACTION.PENDING[pomodoro.next]
      });
      await chrome.action.setBadgeText({ text: "" });
      await chrome.storage.local.set({ currentMode: "idle" });

      if (PREFS.showNotifications) {
        const nextName = chrome.i18n.getMessage(pomodoro.next);
        await chrome.notifications.create({
          type: "basic",
          title: chrome.i18n.getMessage("timer_end_notification_header"),
          message: chrome.i18n.getMessage(
            "timer_end_notification_body",
            nextName
          ),
          iconUrl: ICONS.FULL[timer.type],
          priority: 2
        });
      }

      pomodoro.running = false;
    }
  });

  // 初期状態を確実に設定（拡張機能リロード時）
  console.log("Initializing extension state");
  pomodoro.running = false;
  pomodoro.timer = null;
  pomodoro.next = "work";
  pomodoro.prev = null;
  
  // UIを初期状態に設定
  await chrome.action.setIcon({ path: ICONS.ACTION.PENDING.work });
  await chrome.action.setBadgeText({ text: "" });
  await chrome.action.setBadgeBackgroundColor({ color: [192, 0, 0, 255] });
  await chrome.storage.local.set({ currentMode: "idle" });
  
  console.log("Extension initialized - ready for work timer");

  /* ───── event listeners ───── */

  chrome.action.onClicked.addListener(async () => {
    console.log("Action clicked - running:", pomodoro.running, "next:", pomodoro.next);
    
    if (pomodoro.running) {
      if (PREFS.clickRestarts) {
        console.log("Restarting current timer");
        pomodoro.restart();
      }
    } else {
      console.log("Starting new timer");
      await pomodoro.start();
    }
  });

  chrome.tabs.onUpdated.addListener(async (_, __, tab) => {
    if (pomodoro.prev === "work") {
      await executeInTabIfBlocked("block", tab, PREFS);
    }
  });

  chrome.notifications.onClicked.addListener((_) =>
    chrome.windows.getLastFocused((w) =>
      chrome.windows.update(w.id, { focused: true })
    )
  );

  /* expose setter for options page */
  chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
    if (msg.type === "setPrefs") {
      (async () => {
        Object.assign(PREFS, msg.payload);
        await savePrefs(PREFS);
        sendResponse({ ok: true });
      })();
      return true;
    }

    if (msg.type === "stopTimer") {
      stopPomodoroTimer(sendResponse);
      return true;
    }
  });

  async function stopPomodoroTimer(sendResponse) {
    console.log("Stopping timer");
    if (pomodoro.timer) {
      clearInterval(pomodoro.timer._interval);
      pomodoro.running = false;
      pomodoro.timer = null;
    }

    // 停止後は最初の状態（work待機）に戻す
    pomodoro.next = "work";
    pomodoro.prev = null;

    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setIcon({ path: ICONS.ACTION.PENDING.work });
    await chrome.action.setBadgeBackgroundColor({ color: [192, 0, 0, 255] });
    await executeInAllBlockedTabs("unblock", PREFS);
    await chrome.storage.local.set({ currentMode: "idle" });
    
    console.log("Timer stopped and reset to initial state");
    sendResponse();
  }
})();
