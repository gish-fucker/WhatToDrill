# 服务端权益与 AI 配额设计

## 目标

在不接入假支付、不信任浏览器状态的前提下，为未来 Pro 报告、云端深度复盘和支付回调建立可审计的服务端权益基础。第一项受保护能力是云端 AI 建议：已配置权益服务时，必须登录并通过服务端原子配额预留才能调用上游模型。

基础记录、恢复安全提示、历史、本地建议、导入导出和离线能力永远不依赖账号或权益。

## 方案

采用 Supabase Postgres 表与 `security definer` RPC，应用服务端使用 `service_role` 调用。浏览器不能直接读取或写入权益表，也不能提交 `plan`、`status`、`used` 或 `limit`。

未采用：

- 浏览器 `localStorage` 保存 Pro：可任意篡改，不能保护云端成本。
- Node 进程内计数：重启、扩容或多实例后丢失，不能作为商业配额。
- AI 成功后再计数：并发请求可同时越过限额。
- 只依赖 IP 限流：IP 不是账户，无法支持付费权益，也会误伤共享网络。

IP 限流继续作为滥用防护；账户配额是另一层独立控制。

## 数据模型

### `account_entitlements`

- `user_id uuid`：主键，关联 `auth.users`。
- `plan`：仅允许 `free`、`pro`。
- `status`：仅允许 `active`、`trialing`、`past_due`、`canceled`、`expired`。
- `current_period_end`：Pro 到期时间；缺失或过期时降级为 Free。
- `provider_customer_id`、`provider_subscription_id`：为未来支付回调预留，唯一且可为空。
- `updated_at`：最后变更时间。

没有权益行时按 Free 处理。只有 `plan=pro`、状态为 `active` 或 `trialing` 且周期未结束时才返回有效 Pro。

### `ai_quota_events`

- `id uuid`：由应用请求 ID 提供，主键保证幂等。
- `user_id uuid`。
- `period_start date`：UTC 自然月首日。
- `status`：`reserved`、`completed`、`released`。
- `created_at`、`completed_at`、`released_at`。

配额展示统计已完成事件；配额判定统计已完成事件和最近 10 分钟的预留。超过 10 分钟仍未完成的预留不再占用额度，避免服务崩溃永久锁住用户。

应用服务的 AI 上游超时必须显著短于 10 分钟。完成 RPC 只允许完成仍在 10 分钟窗口内的预留；过期预留按失败处理并释放，避免旧请求在新请求获得额度后再次完成而造成超额。

两个表启用 RLS，不给 `anon` 或 `authenticated` 任何表策略。RPC 撤销 public/anon/authenticated 权限，只授予 `service_role`。

## RPC

### `get_account_entitlement`

输入用户 ID、Free 限额和 Pro 限额，返回有效层级、原始订阅状态、已用、处理中、剩余、限额和下月 UTC 重置时间。

### `reserve_ai_advice_quota`

使用用户 ID 的事务级 advisory lock 串行同一账户的并发预留。重新计算有效权益和当前占用；额度不足时返回 `allowed=false`，否则以请求 ID 插入 `reserved` 事件并返回最新额度。相同用户与请求 ID 重试不得重复扣减；请求 ID 已属于其他用户时必须拒绝，不能返回该事件的信息。

### `complete_ai_advice_quota`

AI 成功后把当前用户的预留改为 `completed`。重复完成保持幂等。

### `release_ai_advice_quota`

AI 超时、上游错误或生成失败时把预留改为 `released`。其他用户不能释放该事件。

## 服务端配置

权益功能在以下环境变量同时存在时视为已启用：

- 已配置 `SUPABASE_URL` 与 `SUPABASE_ANON_KEY` 的账号服务。
- `SUPABASE_SERVICE_ROLE_KEY`。

数据库迁移与 RPC 是否已应用通过真实 RPC 调用判断，不能仅凭环境变量推断。已启用但 RPC 缺失、版本不兼容或暂时不可用时，接口返回 503，绝不静默降级为共享模式或 Free。

限额：

- `FREE_AI_ADVICE_LIMIT`，默认 3。
- `PRO_AI_ADVICE_LIMIT`，默认 100。

`service_role` 只留在服务端，不进入健康接口、页面、日志或 Cookie。配置 service role 却未配置账号时服务拒绝启动。

## 接口

### `GET /api/account/entitlements`

- 未配置权益服务：返回 `{ configured: false }`。
- 未登录：返回 401。
- 已登录：服务端验证 Cookie 对应用户，再调用 RPC；只返回规范化权益摘要。
- 数据库/RPC 不可用：返回 503，不猜测 Free 或 Pro。

### `POST /api/advice`

当权益服务已配置时：

1. 保留现有请求大小、结构和 IP 限流。
2. 验证服务端账户会话，未登录返回 401 `ACCOUNT_REQUIRED`。
3. 用请求 ID 原子预留 AI 配额。
4. 额度不足返回 429 `QUOTA_EXHAUSTED`，不调用 OpenAI。
5. OpenAI 成功则完成预留，并在响应附带最新配额。
6. 上游失败或超时则释放预留，再返回原有错误或本地回退信号。

未配置权益服务时保留部署者现有的共享云端建议模式，以兼容非商业自托管；健康接口明确返回 `aiAccessMode=deployment_shared`。配置权益服务后返回 `aiAccessMode=account_quota`。

## 客户端

已登录且权益服务可用时，账号区域显示：

- 服务层级：Free 或服务器验证的 Pro。
- 云端建议本月已用、剩余和 UTC 重置日期。
- 当前没有购买渠道时显示“付费方案尚未开放”，不显示升级按钮。

权益服务未配置时不显示猜测层级。权益请求失败显示“权益状态暂不可用”，不会把失败解释为 Free 或取消订阅。

云端 AI 配额耗尽时，应用说明本次已回退到本地建议，并刷新服务端额度。任何本地记录和安全建议仍可使用。

## 测试

- SQL 静态检查覆盖 RLS、权限撤销、约束、索引、advisory lock、幂等和 10 分钟预留窗口。
- 配置缺失和 service role 半配置启动失败。
- 模拟 Supabase REST RPC 覆盖 Free 状态、有效 Pro 状态、未登录、服务失败和响应规范化。
- 模拟 OpenAI 覆盖三次 Free 成功、第四次阻止且不调用上游、上游失败释放、完成幂等和并发预留。
- 验证 AI 失败不永久扣减，配额耗尽仍可生成本地建议。
- 登录后权益 UI 只使用服务端响应，登录和额度变化不写入业务 `localStorage`。
- 桌面和 390px 手机无横向溢出。
- 未配置的 GitHub Pages 继续显示本机模式，不展示权益或购买入口。

## 支付边界

本设计不提供手工切换 Pro 的客户端或公开接口。未来支付 webhook 只能在签名、事件幂等、商品映射和用户映射验证后，由服务端 service role 更新 `account_entitlements`。付款返回页不能更新权益。
