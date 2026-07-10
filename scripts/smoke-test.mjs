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
      lastTrendDate: getLastDays(7).at(-1),
      recentIncludesToday: getRecent([{ date: today() }], 7).length,
      coachStatus: document.querySelector(".coach-status")?.textContent,
      coachTitle: document.querySelector(".coach-decision strong")?.textContent,
      onboardingVisible: !document.querySelector("#starterGuide").hidden,
      onboardingText: document.querySelector("#starterGuide")?.innerText,
      retentionTitle: document.querySelector("#retentionInsights h3")?.textContent,
      retentionConfidence: document.querySelector("#retentionInsights .confidence-pill")?.textContent,
      retentionText: document.querySelector("#retentionInsights")?.innerText,
      safetyText: document.querySelector("#safetyStrip")?.innerText,
      exerciseProgressText: document.querySelector("#exerciseProgress")?.innerText,
      overflow: document.documentElement.scrollWidth > innerWidth
    }))()`);
    assert(todayCheck.localToday === todayCheck.inputDate, "Today input should use local browser date.");
    assert(todayCheck.lastTrendDate === todayCheck.localToday, "Trend windows should end on local today.");
    assert(todayCheck.recentIncludesToday === 1, "Recent filters should include local today.");
    assert(todayCheck.coachStatus === "先建立记录", "Empty daily coach should show starter status.");
    assert(todayCheck.coachTitle === "全身入门", "Empty daily coach should recommend full-body beginner template.");
    assert(todayCheck.onboardingVisible, "Empty first-run state should show onboarding.");
    assert(todayCheck.onboardingText.includes("开始 60 秒记录"), "Onboarding should expose the 60-second record action.");
    assert(todayCheck.retentionTitle === "复盘中心", "Insights review center should render on first run.");
    assert(todayCheck.retentionConfidence === "数据偏少", "Empty review center should show low-data confidence.");
    assert(todayCheck.retentionText.includes("数据还不足"), "Empty review center should explain missing data.");
    assert(todayCheck.safetyText.includes("不是医疗诊断"), "Today tab should show a non-medical safety reminder.");
    assert(todayCheck.exerciseProgressText.includes("还没有可分析的动作"), "Empty exercise progress should explain missing workout data.");
    assert(!todayCheck.overflow, "Today desktop layout should not overflow.");

    await evaluate(cdp, `document.querySelector("#pain").value = "4";
      document.querySelector("#pain").dispatchEvent(new Event("input", { bubbles: true }));`);
    await delay(200);
    const highPainSafety = await evaluate(cdp, `document.querySelector("#safetyStrip")?.innerText`);
    assert(highPainSafety.includes("优先恢复"), "High pain should switch safety strip to recovery-first copy.");
    await evaluate(cdp, `document.querySelector("#pain").value = "0";
      document.querySelector("#pain").dispatchEvent(new Event("input", { bubbles: true }));`);

    let pwaReady = await evaluate(cdp, `(async () => {
      if (!("serviceWorker" in navigator)) return { supported: false };
      const registration = await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise(resolve => {
          navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true });
          setTimeout(resolve, 1500);
        });
      }
      return {
        supported: true,
        scope: registration.scope,
        controlled: Boolean(navigator.serviceWorker.controller),
        caches: await caches.keys(),
        status: document.querySelector("#offlineStatus")?.textContent
      };
    })()`);
    if (pwaReady.supported && !pwaReady.controlled) {
      const loaded = cdp.waitFor("Page.loadEventFired").catch(() => null);
      await cdp.send("Page.reload", { ignoreCache: false });
      await loaded;
      await delay(500);
      pwaReady = await evaluate(cdp, `(async () => {
        const registration = await navigator.serviceWorker.ready;
        return {
          supported: true,
          scope: registration.scope,
          controlled: Boolean(navigator.serviceWorker.controller),
          caches: await caches.keys(),
          status: document.querySelector("#offlineStatus")?.textContent
        };
      })()`);
    }
    assert(pwaReady.supported, "Browser should support service workers for PWA smoke test.");
    assert(pwaReady.controlled, "Service worker should control the app after activation.");
    assert(pwaReady.caches.some(name => name.includes("habit-fitness-shell")), "App shell cache should be created.");

    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0
    });
    {
      const loaded = cdp.waitFor("Page.loadEventFired").catch(() => null);
      await cdp.send("Page.reload", { ignoreCache: false });
      await loaded;
      await delay(500);
    }
    const offlineLoad = await evaluate(cdp, `(() => ({
      title: document.title,
      hasApp: Boolean(document.querySelector(".app-shell")),
      status: document.querySelector("#offlineStatus")?.textContent,
      overflow: document.documentElement.scrollWidth > innerWidth
    }))()`);
    assert(offlineLoad.title === "日常与健身记录", "Offline reload should serve the cached app shell.");
    assert(offlineLoad.hasApp, "Offline reload should render the app shell.");
    assert(!offlineLoad.overflow, "Offline app shell should not overflow.");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1
    });
    {
      const loaded = cdp.waitFor("Page.loadEventFired").catch(() => null);
      await cdp.send("Page.reload", { ignoreCache: false });
      await loaded;
      await delay(500);
    }

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

    await evaluate(cdp, `(() => {
      const days = getLastDays(7);
      const dailyLogs = days.slice(1).map((date, index) => ({
        id: "daily-risk-" + index,
        date,
        sleepHours: index < 3 ? 5.5 : 6,
        waterMl: index % 2 ? 1400 : 1900,
        mood: 3,
        energy: 2,
        soreness: 4,
        pain: index === 4 ? 4 : 3,
        habits: { workout: false, stretch: false, study: false, earlySleep: false },
        note: ""
      }));
      const workouts = [days[4], days[6]].map((date, index) => ({
        id: "workout-risk-" + index,
        date,
        title: index ? "下肢高强度" : "上肢高强度",
        duration: 50,
        sessionRpe: 8,
        note: "",
        exercises: [{
          name: index ? "腿举" : "坐姿划船",
          sets: [
            { weight: 30, reps: 10, rpe: 8, note: "" },
            { weight: 30, reps: 10, rpe: 8, note: "" },
            { weight: 30, reps: 8, rpe: 9, note: "" }
          ]
        }]
      }));
      localStorage.setItem(${JSON.stringify(storageKey)}, JSON.stringify({
        dailyLogs,
        workouts,
        exercises: [],
        templates: [],
        adviceHistory: [],
        settings: { waterStepMl: 500 }
      }));
    })()`);
    await reload(cdp);
    await evaluate(cdp, `document.querySelector('[data-tab="insights"]').click(); window.scrollTo(0, 0);`);
    await delay(300);
    const riskReview = await evaluate(cdp, `(() => ({
      confidence: document.querySelector("#retentionInsights .confidence-pill")?.textContent,
      text: document.querySelector("#retentionInsights")?.innerText,
      report: buildWeeklyReportText(),
      overflow: document.documentElement.scrollWidth > innerWidth
    }))()`);
    assert(riskReview.confidence === "复盘可信", "Enough data review should show high confidence.");
    assert(riskReview.text.includes("出现高疼痛信号"), "High pain should render a recovery risk.");
    assert(riskReview.text.includes("高强度"), "High RPE should render an intensity warning.");
    assert(riskReview.report.includes("## 本周摘要"), "Weekly report should include summary section.");
    assert(riskReview.report.includes("## 风险提醒"), "Weekly report should include risk section.");
    assert(riskReview.report.includes("## 下周行动"), "Weekly report should include next actions.");
    assert(riskReview.report.includes("## 安全说明"), "Weekly report should include safety disclaimer.");
    assert(!riskReview.overflow, "Insights desktop layout should not overflow.");

    await evaluate(cdp, `(() => {
      const days = getLastDays(7);
      const workouts = [days[1], days[3], days[6]].map((date, index) => ({
        id: "progress-workout-" + index,
        date,
        title: "动作进步 " + (index + 1),
        duration: 40,
        sessionRpe: index === 2 ? 6 : 7,
        note: "",
        exercises: [{
          name: "腿举",
          sets: [
            { weight: 20 + index * 5, reps: 10, rpe: index === 2 ? 6 : 7, note: "" },
            { weight: 20 + index * 5, reps: 8, rpe: 7, note: "" }
          ]
        }]
      }));
      localStorage.setItem(${JSON.stringify(storageKey)}, JSON.stringify({
        dailyLogs: [],
        workouts,
        exercises: [{ name: "腿举", category: "力量", lastUsed: days[6] }],
        templates: [],
        adviceHistory: [],
        settings: { waterStepMl: 500, waterTargetMl: 2000, weeklyWorkoutTarget: 2, trainingGoal: "general", preferredEnvironment: "gym", conservativeMode: false }
      }));
    })()`);
    await reload(cdp);
    await evaluate(cdp, `document.querySelector('[data-tab="insights"]').click(); window.scrollTo(0, 0);`);
    await delay(250);
    const progressReview = await evaluate(cdp, `(() => ({
      text: document.querySelector("#exerciseProgress")?.innerText,
      overflow: document.documentElement.scrollWidth > innerWidth
    }))()`);
    assert(progressReview.text.includes("腿举"), "Exercise progress should show repeated exercise names.");
    assert(progressReview.text.includes("可判断"), "Exercise progress should mark exercises with enough sessions.");
    assert(progressReview.text.includes("小幅加重量") || progressReview.text.includes("多做一组"), "Exercise progress should suggest a next progression when RPE is manageable.");
    assert(!progressReview.overflow, "Exercise progress desktop layout should not overflow.");

    await evaluate(cdp, `document.querySelector('[data-tab="library"]').click(); window.scrollTo(0, 0);`);
    await delay(250);
    const trustCenter = await evaluate(cdp, `document.querySelector(".trust-center")?.innerText`);
    assert(trustCenter.includes("不是医疗诊断"), "Trust center should explain non-medical scope.");
    assert(trustCenter.includes("默认本地保存"), "Trust center should explain local-first storage.");
    assert(trustCenter.includes("云端建议可控"), "Trust center should explain cloud advice behavior.");

    const preferences = await evaluate(cdp, `(() => {
      const days = getLastDays(7);
      state.dailyLogs = days.slice(2).map((date, index) => ({
        id: "pref-daily-" + index,
        date,
        sleepHours: 7,
        waterMl: 2300,
        mood: 4,
        energy: 4,
        soreness: 2,
        pain: 0,
        habits: {},
        note: ""
      }));
      state.workouts = [days[2], days[4], days[6]].map((date, index) => ({
        id: "pref-workout-" + index,
        date,
        title: "偏好训练 " + (index + 1),
        duration: 40,
        sessionRpe: 6,
        note: "",
        exercises: [{ name: "腿举", sets: [{ weight: 20, reps: 10, rpe: 6, note: "" }] }]
      }));
      document.querySelector("#trainingGoal").value = "fat_loss";
      document.querySelector("#preferredEnvironment").value = "home";
      document.querySelector("#weeklyWorkoutTarget").value = "3";
      document.querySelector("#waterTargetMl").value = "2400";
      document.querySelector("#conservativeMode").checked = true;
      document.querySelector("#savePreferencesBtn").click();
      const parsed = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));
      document.querySelector('[data-tab="today"]').click();
      const todayText = document.querySelector("#todayDashboard")?.innerText;
      document.querySelector('[data-tab="insights"]').click();
      const insightText = document.querySelector("#retentionInsights")?.innerText;
      return {
        settings: parsed.settings,
        todayText,
        insightText
      };
    })()`);
    assert(preferences.settings.trainingGoal === "fat_loss", "Preferences should save training goal.");
    assert(preferences.settings.preferredEnvironment === "home", "Preferences should save preferred environment.");
    assert(preferences.settings.weeklyWorkoutTarget === 3, "Preferences should save weekly workout target.");
    assert(preferences.settings.waterTargetMl === 2400, "Preferences should save water target.");
    assert(preferences.settings.conservativeMode, "Preferences should save conservative mode.");
    assert(preferences.todayText.includes("2400ml"), "Today dashboard should use preferred water target.");
    assert(preferences.insightText.includes("每周 3 次训练目标"), "Retention actions should use weekly workout target.");

    await evaluate(cdp, `document.querySelector('[data-tab="library"]').click(); window.scrollTo(0, 0);`);
    await delay(100);
    const invalidImport = await evaluate(cdp, `(async () => {
      const file = new File([JSON.stringify({ dailyLogs: "broken" })], "broken-backup.json", { type: "application/json" });
      importData(file);
      await new Promise(resolve => setTimeout(resolve, 250));
      return {
        preview: document.querySelector("#importPreview")?.innerText,
        disabled: document.querySelector("#confirmImportBtn")?.disabled,
        workouts: JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})).workouts.length
      };
    })()`);
    assert(invalidImport.preview.includes("需修复"), "Invalid import should show a blocked preview.");
    assert(invalidImport.disabled, "Invalid import should disable confirmation.");
    assert(invalidImport.workouts === 3, "Invalid import should not overwrite current data.");

    const validImport = await evaluate(cdp, `(async () => {
      const payload = {
        dailyLogs: [{ id: "import-daily", date: today(), sleepHours: 7, waterMl: 2000, mood: 4, energy: 4, soreness: 2, pain: 0, habits: {}, note: "" }],
        workouts: [{ id: "import-workout", date: today(), title: "导入训练", duration: 35, sessionRpe: 6, note: "", exercises: [{ name: "腿举", sets: [{ weight: 20, reps: 10, rpe: 6, note: "" }] }] }],
        exercises: [{ name: "腿举", category: "力量", lastUsed: today() }],
        templates: [],
        adviceHistory: [],
        settings: { waterStepMl: 300 }
      };
      const file = new File([JSON.stringify(payload)], "valid-backup.json", { type: "application/json" });
      importData(file);
      await new Promise(resolve => setTimeout(resolve, 250));
      const before = document.querySelector("#importPreview")?.innerText;
      document.querySelector("#confirmImportBtn").click();
      await new Promise(resolve => setTimeout(resolve, 350));
      const parsed = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));
      return {
        before,
        dailyLogs: parsed.dailyLogs.length,
        workouts: parsed.workouts.length,
        waterStep: parsed.settings.waterStepMl,
        health: document.querySelector("#dataHealth")?.innerText,
        previewAfter: document.querySelector("#importPreview")?.innerText
      };
    })()`);
    assert(validImport.before.includes("可导入"), "Valid import should show an importable preview.");
    assert(validImport.dailyLogs === 1 && validImport.workouts === 1, "Confirmed import should overwrite local records.");
    assert(validImport.waterStep === 300, "Confirmed import should restore settings.");
    assert(validImport.health.includes("1 条") && validImport.health.includes("1 次"), "Data health should update after import.");
    assert(validImport.previewAfter.includes("导入前会先预览"), "Import preview should reset after confirmation.");
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

    await evaluate(cdp, `document.querySelector('[data-tab="insights"]').click(); window.scrollTo(0, 0);`);
    await delay(250);
    const mobileInsights = await evaluate(cdp, `(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      title: document.querySelector("#retentionInsights h3")?.textContent,
      exportButtonWidth: document.querySelector("#exportWeeklyReportBtn")?.getBoundingClientRect().width,
      overflow: document.documentElement.scrollWidth > innerWidth
    }))()`);
    assert(mobileInsights.title === "复盘中心", "Mobile insights should render the review center.");
    assert(mobileInsights.exportButtonWidth <= mobileInsights.width, "Mobile report export button should fit.");
    assert(!mobileInsights.overflow, "Mobile insights layout should not overflow.");
    await screenshot(cdp, "smoke-mobile-insights.png");

    console.log(JSON.stringify({
      ok: true,
      checks: {
        today: todayCheck,
        loadedWorkout,
        blockedSave,
        oneSetProgress,
        savedWorkout,
        riskReview,
        mobile,
        mobileInsights
      },
      screenshots: [
        "output/playwright/smoke-desktop.png",
        "output/playwright/smoke-mobile.png",
        "output/playwright/smoke-mobile-insights.png"
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
