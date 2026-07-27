# Training Recommendation Golden Scenarios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可审计的训练推荐黄金场景矩阵，修复矩阵暴露的可信度缺陷，并保持现有数据与交互兼容。

**Architecture:** 扩展现有 `TrainingRotationModel` 为唯一纯推荐决策层；`app.js` 只提供状态输入、添加持久化元数据并消费模型输出。黄金测试直接加载纯模型，smoke 测试验证浏览器集成和迁移。

**Tech Stack:** 原生 JavaScript、Node `assert`/`vm`、现有 Playwright smoke harness、localStorage JSON schema v2。

## Global Constraints

- 不新增模板；只使用当前存在的内置或用户模板。
- 不保存不必要的健康原始数据副本。
- 保持旧 localStorage、旧 JSON、历史训练、Strong/Hevy 导入、手动修改下次计划、本地优先和 P0/P1 交互。
- 完整测试通过，关键推荐套件连续执行两次。
- 只暂存和提交本任务文件。

---

### Task 1: 黄金场景与失败证据

**Files:**
- Create: `scripts/training-recommendation-golden-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `globalThis.TrainingRotationModel`
- Produces: 场景表、规则覆盖汇总和失败断言

- [x] 定义环境、目标、恢复和历史的 pairwise 场景，场景对象包含 `id`、`rules`、`input` 与精确断言。
- [x] 加入 A/B/恢复链路、连续未达标、最近同动作、漏过日期、重复 ID、缺失模板和手动计划保留测试。
- [x] 新增 `test:training-recommendation` script 并运行，确认当前实现因缺少纯决策入口而失败。

### Task 2: 纯推荐决策模型

**Files:**
- Modify: `public/training-rotation-model.js`
- Test: `scripts/training-recommendation-golden-test.mjs`

**Interfaces:**
- Produces: `buildRecommendationDecision(input)` 和 `preserveUserPlan(existingPlan, trigger)`
- `buildRecommendationDecision` 返回 `{ template, exercises, decision, reasons, adjustments }` 或带稳定错误码的无效结果。

- [x] 添加模板器械归一化、器械子集校验、环境模板选择和结果完整性校验。
- [x] 添加目标处方、临时恢复调整、安全覆盖、按动作历史推进和连续未达标保守处理。
- [x] 生成 9 个审计字段，并仅从字段映射用户理由。
- [x] 运行黄金套件，修复到全部场景通过。

### Task 3: 应用集成与兼容迁移

**Files:**
- Modify: `public/app.js`
- Modify: `scripts/smoke-test.mjs`

**Interfaces:**
- Consumes: `TrainingRotationModel.buildRecommendationDecision(input)`
- Persists: 可选 `nextWorkoutPlan.decision`，不包含健康原始值

- [x] 让 `buildNextWorkoutPlan` 使用纯模型结果，并保留现有 ID、日期、状态和 UI 字段。
- [x] 正常化可选决策字段；旧计划无字段时继续可用。
- [x] 在重新渲染和无关设置保存路径上保留用户已修改计划。
- [x] 添加浏览器 smoke 断言，验证理由来自决策、旧备份迁移和手动计划不被覆盖。

### Task 4: 完整验证与发布

**Files:**
- Modify: `README.md` only if data schema documentation is required

**Interfaces:**
- Produces: 可复现的测试输出、单一 scoped commit 和远端 SHA

- [x] 运行 `npm.cmd run check`。
- [x] 连续运行两次 `npm.cmd run test:training-recommendation`。
- [x] 运行 `npm.cmd run test:smoke`，并复核 Git diff 与未跟踪用户文件。
- [x] 只暂存本计划列出的实际任务文件，提交、推送 `main`，读取并报告远端 commit SHA。
