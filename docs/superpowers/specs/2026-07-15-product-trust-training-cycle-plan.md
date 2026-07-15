# WhatToDrill 产品可信度与训练轮换实施计划

日期：2026-07-15

## 目标

按已确认的设计统一产品身份，引入兼容的训练轮换和可修改下次计划，按数据渐进展示进步页，并通过自动化与真实浏览器验证现有训练闭环不回退。

## 任务 1：建立纯决策模型和测试

涉及文件：

- `public/training-rotation-model.js`（新增）
- `scripts/training-rotation-test.mjs`（新增）
- `package.json`

步骤：

1. 定义默认轮换、轮换规范化、下一训练日解析、同训练日历史查找和进步页可见性函数。
2. 为全身、上下肢、自定义、模板缺失、旧数据、首次基线、同训练日比较和轮换推进编写 Node 单元测试。
3. 将新文件加入语法检查、专项测试和冒烟测试前置命令。

验证：`npm run check`、`npm run test:training-rotation`。

## 任务 2：接入状态、导入导出和下次计划生成

涉及文件：

- `public/app.js`
- `public/workout-session-model.js`（仅在会话元数据确有需要时修改）

步骤：

1. 在默认设置、加载、重置、导入预览和导入提交中规范化 `trainingRotation`。
2. 将下一计划兼容升级到版本 2，保留版本 1 的动作、日期和理由。
3. 保存训练的 `rotationDayId`、`sourceTemplateId`，并用同训练日历史而非刚完成训练调整负荷。
4. 只在确认或实际开始建议计划时推进轮换；查看、改日期和关闭不推进。
5. 对模板删除、计划来源失效和本地保存失败实施保守回退。

验证：专项模型测试、现有训练会话测试、导入导出冒烟测试。

## 任务 3：实现轮换设置和计划确认界面

涉及文件：

- `public/app/index.html`
- `public/app.js`
- `public/styles.css`

步骤：

1. 在“我的”页增加全身、上下肢、自定义训练顺序设置。
2. 自定义顺序允许选择 2–6 个现有模板、命名、上移、下移和删除。
3. 完成结果显示日期、训练日、动作数、预计时长、轮换理由和同日调整。
4. 增加确认、改日期、换训练日、恢复训练和自行决定操作。
5. 保持键盘焦点、对话框关闭、390px 布局和单一主动作层级。

验证：桌面和移动端冒烟路径、无横向溢出、键盘操作。

## 任务 4：统一品牌并清理过期表面

涉及文件：

- `public/index.html`
- `public/app/index.html`
- `public/manifest.webmanifest`
- `public/privacy.html`
- `public/terms.html`
- `public/app.js`
- `public/sw.js`
- `README.md`
- `package.json`
- 相关测试

步骤：

1. 将当前用户表面统一为 `WhatToDrill · 今天练什么` 和确认的产品说明。
2. 更新导出标题、下载文件名、安装信息与缓存版本。
3. 删除“下一轮提供”等已过期文案。
4. 隐藏没有购买路径的 Pro 占位；仅服务器确认 Pro 时显示长期报告。
5. 扫描当前用户表面中的旧品牌、旧公开地址和开发阶段文案。

验证：品牌扫描、PWA manifest 检查、现有法律页和离线缓存冒烟测试。

## 任务 5：实现首页优先级和进步页渐进展示

涉及文件：

- `public/app.js`
- `public/app/index.html`
- `public/styles.css`
- `scripts/smoke-test.mjs`

步骤：

1. 首页按“继续草稿 → 已确认计划 → 今日建议”选择唯一视觉主动作。
2. 使用纯可见性结果控制 0、1、2、3 次训练、7 个有效观察日和 28 天报告模块。
3. 解释有效观察日并给出下一次记录动作。
4. 避免状态、支持伙伴和规律进度重新占满首屏。

验证：各数据门槛下的 DOM 断言和桌面/移动截图。

## 任务 6：完整验证与反馈审计

涉及文件：

- `scripts/smoke-test.mjs`
- `output/playwright/`
- 用户反馈清单（只读依据）

步骤：

1. 运行 `npm run check`、全部专项测试和 `npm run test:smoke`。
2. 在桌面和 390px 手机视口验证品牌、轮换设置、上肢到下肢、同日历史负荷、计划修改、首页优先级和进步页门槛。
3. 检查控制台错误、横向溢出、焦点和页面刷新后的持久化。
4. 对反馈 P0 1–4 和相关 P1 5、7、8 逐项建立代码、测试或浏览器证据。
5. 未属于本阶段的 P1 训练高频工具与 P2 云同步明确记录为后续范围，不把它们误报为已完成。

最终验证：`npm run check && npm run test:workout-session && npm run test:training-rotation && npm run test:entitlements && npm run test:smoke`。
