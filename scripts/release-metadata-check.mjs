import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [packageText, server, render, envExample, app, appHtml, serviceWorker, manifestText, readme, privacy, terms, workflow] = await Promise.all([
  read("package.json"), read("server.js"), read("render.yaml"), read(".env.example"),
  read("public/app.js"), read("public/app/index.html"), read("public/sw.js"),
  read("public/manifest.webmanifest"), read("README.md"), read("public/privacy.html"),
  read("public/terms.html"), read(".github/workflows/pages.yml")
]);
const packageMetadata = JSON.parse(packageText);
const manifest = JSON.parse(manifestText);

assert.match(packageMetadata.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "package.json version must be semantic.");
assert.equal(packageMetadata.name, "what-to-drill");
assert.match(server, /const appVersion = packageMetadata\.version;/);
assert.doesNotMatch(server, /process\.env\.APP_VERSION/);
assert.match(render, /name:\s+what-to-drill\b/);
assert.doesNotMatch(render, /daily-record-app|APP_VERSION/);
assert.doesNotMatch(envExample, /APP_VERSION/);
assert.match(appHtml, /data-app-version="__APP_VERSION__"/);
assert.match(app, /document\.documentElement\.dataset\.appVersion/);
assert(appHtml.indexOf("../workout-session-controller.js") > appHtml.indexOf("../workout-session-model.js") && appHtml.indexOf("../workout-session-controller.js") < appHtml.indexOf("../app.js"));
assert(appHtml.indexOf("../local-beta-funnel-model.js") >= 0 && appHtml.indexOf("../local-beta-funnel-model.js") < appHtml.indexOf("../app.js"));
assert.match(serviceWorker, /what-to-drill-shell-v__APP_VERSION__/);
assert.match(serviceWorker, /workout-session-controller\.js\?v=__APP_VERSION__/);
assert.match(serviceWorker, /local-beta-funnel-model\.js\?v=__APP_VERSION__/);
assert.equal(Object.hasOwn(manifest, "version"), false, "The web manifest must not carry an independent release version.");
assert.match(workflow, /npm run build:pages/);
assert.match(workflow, /path:\s+\.pages/);
assert.doesNotMatch(readme, /当前版本可选提供基础账号身份，但没有云同步|支付、云同步和多设备协作/);
assert.match(readme, /GitHub Pages.*不提供云端 AI、账号、同步或支付/s);
assert.match(readme, /Node\/Render 未完整配置 Supabase 时是本机模式/);
assert.match(readme, /只有用户登录并主动点击“开启云备份”/);
assert.match(privacy, /生效日期：2026 年 7 月 27 日/);
assert.match(privacy, /当前应用没有删除 Supabase 认证账号的功能/);
assert.match(privacy, /本地 Beta 记录不是在线用户分析/);
assert.match(privacy, /不会上传健康内容/);
assert.match(readme, /本地 Beta 记录与普通数据完全分开/);
assert.match(terms, /当前应用没有删除认证账号的入口/);

console.log(`Release metadata and product promises are consistent at ${packageMetadata.version}.`);
