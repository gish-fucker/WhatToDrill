import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const appPort = Number(process.env.SMOKE_APP_PORT || 5183);
const chromePort = Number(process.env.SMOKE_CHROME_PORT || 9240);
const baseUrl = `http://localhost:${appPort}`;
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const outputDir = resolve("output", "playwright");
const profileDir = resolve(outputDir, "smoke-profile");
const storageKey = "habit_fitness_app_v1";

class CdpClient {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 1;
    this.pending = new Map();
    this.events = new Map();
    this.ws.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result || {});
        return;
      }
      if (message.method && this.events.has(message.method)) {
        this.events.get(message.method).forEach(resolveEvent => resolveEvent(message.params || {}));
        this.events.delete(message.method);
      }
    });
  }

  ready() {
    return new Promise(resolveReady => this.ws.addEventListener("open", resolveReady, { once: true }));
  }

  send(method, params = {}) {
    const id = this.id++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveSend, rejectSend) => {
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend });
    });
  }

  waitFor(method, timeoutMs = 8000) {
    return new Promise((resolveWait, rejectWait) => {
      const timeout = setTimeout(() => rejectWait(new Error(`Timed out waiting for ${method}`)), timeoutMs);
      const handler = params => {
        clearTimeout(timeout);
        resolveWait(params);
      };
      const handlers = this.events.get(method) || [];
      handlers.push(handler);
      this.events.set(method, handlers);
    });
  }

  close() {
    this.ws.close();
  }
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

async function waitForHttp(url, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      await delay(250);
    }
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Request failed: ${url}`);
  return response.json();
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
    throw new Error(detail || "Runtime evaluation failed");
  }
  return result.result.value;
}

async function reload(cdp) {
  const loaded = cdp.waitFor("Page.loadEventFired").catch(() => null);
  await cdp.send("Page.reload", { ignoreCache: true });
  await loaded;
  await delay(350);
}

async function navigate(cdp, url) {
  const loaded = cdp.waitFor("Page.loadEventFired").catch(() => null);
  await cdp.send("Page.navigate", { url });
  await loaded;
  await delay(350);
}

async function screenshot(cdp, filename) {
  const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(resolve(outputDir, filename), Buffer.from(shot.data, "base64"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run() {
  await mkdir(outputDir, { recursive: true });
  await mkdir(profileDir, { recursive: true });

  const server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(appPort) },
    stdio: "ignore",
    windowsHide: true
  });

  const chrome = spawn(chromePath, [
    "--headless=new",
    `--remote-debugging-port=${chromePort}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--disable-default-apps",
    "--disable-gpu",
    "--window-size=1440,1100",
    baseUrl
  ], {
    stdio: "ignore",
    windowsHide: true
  });

  let cdp;
  try {
    await waitForHttp(baseUrl);
    await waitForHttp(`http://localhost:${chromePort}/json/version`);
    const pages = await getJson(`http://localhost:${chromePort}/json/list`);
    const page = pages.find(item => item.type === "page") || pages[0];
    cdp = new CdpClient(page.webSocketDebuggerUrl);
    await cdp.ready();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await navigate(cdp, baseUrl);

    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1100,
      deviceScaleFactor: 1,
      mobile: false
    });
    await evaluate(cdp, `localStorage.removeItem(${JSON.stringify(storageKey)})`);
    await reload(cdp);

    const todayCheck = await evaluate(cdp, `(() => ({
      localToday: today(),
      inputDate: document.querySelector("#dailyDate").value,
      coachStatus: document.querySelector(".coach-status")?.textContent,
      coachTitle: document.querySelector(".coach-decision strong")?.textContent,
      onboardingVisible: !document.querySelector("#starterGuide").hidden,
      onboardingText: document.querySelector("#starterGuide")?.innerText,
      overflow: document.documentElement.scrollWidth > innerWidth
    }))()`);
    assert(todayCheck.localToday === todayCheck.inputDate, "Today input should use local browser date.");
    assert(todayCheck.coachStatus === "先建立记录", "Empty daily coach should show starter status.");
    assert(todayCheck.coachTitle === "全身入门", "Empty daily coach should recommend full-body beginner template.");
    assert(todayCheck.onboardingVisible, "Empty first-run state should show onboarding.");
    assert(todayCheck.onboardingText.includes("开始 60 秒记录"), "Onboarding should expose the 60-second record action.");
    assert(!todayCheck.overflow, "Today desktop layout should not overflow.");

    await evaluate(cdp, `document.querySelector("#startOnboardingRecordBtn").click()`);
    await delay(900);
    const onboardingAction = await evaluate(cdp, `(() => ({
      formTop: document.querySelector("#dailyForm").getBoundingClientRect().top,
      formBottom: document.querySelector("#dailyForm").getBoundingClientRect().bottom,
      viewportHeight: innerHeight,
      highlighted: document.querySelectorAll(".onboarding-highlight").length
    }))()`);
    assert(onboardingAction.formTop < onboardingAction.viewportHeight && onboardingAction.formBottom > 0, "Onboarding primary action should scroll the daily form into view.");
    assert(onboardingAction.highlighted >= 4, "Onboarding primary action should highlight key body-state fields.");

    await evaluate(cdp, `document.querySelector("#sleepHours").value = "7";
      document.querySelector("#sleepHours").dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("#saveDailyBtn").click();`);
    await delay(500);
    const afterDailySave = await evaluate(cdp, `(() => ({
      hidden: document.querySelector("#starterGuide").hidden,
      dailyLogs: JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})).dailyLogs.length
    }))()`);
    assert(afterDailySave.dailyLogs === 1, "Saving daily state should create the first daily log.");
    assert(afterDailySave.hidden, "Saving a daily log should hide onboarding.");

    await evaluate(cdp, `localStorage.removeItem(${JSON.stringify(storageKey)})`);
    await reload(cdp);

    await evaluate(cdp, `document.querySelector("#startCoachWorkoutBtn").click()`);
    await delay(300);
    const loadedWorkout = await evaluate(cdp, `(() => ({
      activeTab: document.querySelector(".tab.active")?.dataset.tab,
      title: document.querySelector("#workoutTitle").value,
      progress: document.querySelector(".progress-ring strong").textContent,
      sets: Array.from(document.querySelectorAll(".execution-stat strong")).map(el => el.textContent)[1],
      collectedSets: collectWorkoutExercises().reduce((sum, exercise) => sum + exercise.sets.length, 0)
    }))()`);
    assert(loadedWorkout.activeTab === "workout", "Coach start should activate workout tab.");
    assert(loadedWorkout.title === "今日建议 - 全身入门", "Coach start should prefill workout title.");
    assert(loadedWorkout.progress === "0", "Loaded template should start at 0 percent complete.");
    assert(loadedWorkout.sets === "0/11", "Loaded beginner template should expose 11 planned sets.");
    assert(loadedWorkout.collectedSets === 0, "Template cues should not count as completed workout sets.");

    await evaluate(cdp, `document.querySelector("#finishWorkoutBtn").click()`);
    await delay(400);
    const blockedSave = await evaluate(cdp, `(() => {
      const raw = localStorage.getItem(${JSON.stringify(storageKey)});
      const parsed = raw ? JSON.parse(raw) : { workouts: [] };
      return {
        workouts: parsed.workouts.length,
        toast: document.querySelector("#toast").textContent,
        hasSummary: Boolean(document.querySelector(".execution-summary"))
      };
    })()`);
    assert(blockedSave.workouts === 0, "Empty template workout should not be saved.");
    assert(blockedSave.toast.includes("请至少记录"), "Blocked save should explain missing set data.");
    assert(!blockedSave.hasSummary, "Blocked save should not show a completion summary.");

    await evaluate(cdp, `document.querySelector(".set-weight").value = "20";
      document.querySelector(".set-weight").dispatchEvent(new Event("input", { bubbles: true }));`);
    await delay(250);
    const oneSetProgress = await evaluate(cdp, `(() => ({
      progress: document.querySelector(".progress-ring strong").textContent,
      sets: Array.from(document.querySelectorAll(".execution-stat strong")).map(el => el.textContent)[1],
      collectedSets: collectWorkoutExercises().reduce((sum, exercise) => sum + exercise.sets.length, 0)
    }))()`);
    assert(oneSetProgress.progress === "9", "One completed set should make 1/11 progress.");
    assert(oneSetProgress.sets === "1/11", "Execution panel should show one completed set.");
    assert(oneSetProgress.collectedSets === 1, "Only one real set should be collected for saving.");

    await evaluate(cdp, `document.querySelector("#finishWorkoutBtn").click()`);
    await delay(650);
    const savedWorkout = await evaluate(cdp, `(() => {
      const parsed = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));
      return {
        workouts: parsed.workouts.length,
        savedSets: parsed.workouts[0].exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0),
        summary: document.querySelector(".execution-summary")?.innerText,
        overflow: document.documentElement.scrollWidth > innerWidth
      };
    })()`);
    assert(savedWorkout.workouts === 1, "One workout should be saved after entering a real set.");
    assert(savedWorkout.savedSets === 1, "Saved workout should include exactly one real set.");
    assert(savedWorkout.summary?.includes("刚刚保存"), "Saved workout should show completion summary.");
    assert(!savedWorkout.overflow, "Workout desktop layout should not overflow.");
    await screenshot(cdp, "smoke-desktop.png");

    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 900,
      deviceScaleFactor: 2,
      mobile: true
    });
    await reload(cdp);
    await evaluate(cdp, `document.querySelector('[data-tab="workout"]').click(); window.scrollTo(0, 0);`);
    await delay(250);
    const mobile = await evaluate(cdp, `(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      overflow: document.documentElement.scrollWidth > innerWidth
    }))()`);
    assert(mobile.width === 390, "Mobile viewport should be active.");
    assert(!mobile.overflow, "Mobile workout layout should not overflow.");
    await screenshot(cdp, "smoke-mobile.png");

    console.log(JSON.stringify({
      ok: true,
      checks: {
        today: todayCheck,
        loadedWorkout,
        blockedSave,
        oneSetProgress,
        savedWorkout,
        mobile
      },
      screenshots: [
        "output/playwright/smoke-desktop.png",
        "output/playwright/smoke-mobile.png"
      ]
    }, null, 2));
  } finally {
    if (cdp) cdp.close();
    chrome.kill();
    server.kill();
  }
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
