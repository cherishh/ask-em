# ask'em 同步功能实现 Plan

## 1. 目标

基于 `docs/superpowers/specs/2026-03-27-ask-em-sync-spec.md`，从零开始实现一个新项目，使其满足：

- workspace 驱动同步
- 仅从新对话创建 workspace
- 4 个 provider：Claude / ChatGPT / Gemini / DeepSeek
- 反向同步
- 恢复与重绑定
- popup 中的 workspace 管理与清理


## 2. 范围

本期范围内：

- 新消息协议
- workspace / workspaceIndex / claimedTab 存储
- background 路由与恢复
- content script 启动、heartbeat、强校验
- 4 个 provider adapter
- popup 的 workspace 管理 UI
- 基础自动化测试

本期范围外：

- 补历史
- 附件 / 图片同步
- 自动合并 workspace
- 高级搜索/归档 UI

## 3. 代码结构建议

```text
src/
  adapters/
    claude.ts
    chatgpt.ts
    gemini.ts
    deepseek.ts
    registry.ts
    sites.ts
    types.ts
  entrypoints/
    background.ts
    claude.content.ts
    chatgpt.content.ts
    gemini.content.ts
    deepseek.content.ts
    popup/
      App.tsx
      main.tsx
      index.html
  runtime/
    protocol.ts
    storage.ts
    workspace.ts
    recovery.ts
    heartbeat.ts
    guards.ts
  utils/
    content-bootstrap.ts
    content-routing.ts
```

## 4. 分阶段任务

### Phase 0: 新项目脚手架

目标：

- 初始化一个可独立开发的新扩展项目

文件：

- `package.json`
- `wxt.config.ts`
- `tsconfig.json`
- `postcss.config.js`
- `src/entrypoints/popup/*`
- `src/entrypoints/background.ts`

任务：

- [ ] 初始化 WXT + React + TypeScript 项目
- [ ] 配置 Manifest V3
- [ ] 配置 `storage` / `tabs` 权限
- [ ] 建立 `src/` 基础目录
- [ ] 建立 docs 目录并拷入 spec / plan
- [ ] 确保 `pnpm install`、`pnpm compile`、`pnpm build` 可执行

完成标准：

- 新项目可独立安装依赖、编译、打包
- 不依赖旧仓库中的任何源码文件

### Phase 1: 建立基础类型与协议

目标：

- 用新的 workspace 模型替换当前简单 `SYNC_SEND`

文件：

- `src/runtime/protocol.ts`
- `src/adapters/types.ts`
- `src/adapters/sites.ts`
- `src/adapters/registry.ts`

任务：

- [ ] 定义 `Provider`
- [ ] 定义 `ConversationRef`
- [ ] 定义 `Workspace`
- [ ] 定义 `WorkspaceIndex`
- [ ] 定义 `ClaimedTab`
- [ ] 定义 `HELLO` / `HEARTBEAT` / `GET_STATUS` / `CLEAR_WORKSPACE` 等消息
- [ ] 在 `sites.ts` 中加入 `deepseek`
- [ ] 在 `registry.ts` 中加入 `deepseek` adapter 注册

完成标准：

- 所有共享类型从旧 `messaging.ts` 迁移到新协议文件
- 类型检查通过

### Phase 2: 存储层与 workspace 管理

目标：

- 建立 `storage.local` 与 `storage.session` 的读写封装

文件：

- `src/runtime/storage.ts`
- `src/runtime/workspace.ts`

任务：

- [ ] 实现 local state 读写 helpers
- [ ] 实现 session state 读写 helpers
- [ ] 实现 `createPendingWorkspace`
- [ ] 实现 `bindWorkspaceMember`
- [ ] 实现 `lookupWorkspaceBySession`
- [ ] 实现 `clearWorkspace`
- [ ] 实现 `clearWorkspaceProvider`
- [ ] 实现 `enforceWorkspaceLimit(2)`
- [ ] 实现 pending workspace 清理逻辑

完成标准：

- workspace 与 workspaceIndex 的增删改查可单独测试

### Phase 3: Background 路由与恢复

目标：

- 让 background 成为唯一的同步编排者

文件：

- `src/entrypoints/background.ts`
- `src/runtime/recovery.ts`
- `src/runtime/guards.ts`

任务：

- [ ] 用新协议重写 background
- [ ] 处理 source conversation -> workspace 的解析
- [ ] 处理首次创建 pending workspace
- [ ] 处理连续同步与反向同步
- [ ] 处理 claimed tab 的选择
- [ ] 实现写入前强校验
- [ ] 实现恢复到已保存 URL
- [ ] 实现恢复失败后的 provider 重绑定
- [ ] 实现 workspace 数量上限阻止逻辑

完成标准：

- background 不再依赖简单 tab registry
- 具备完整的 workspace 路由能力

### Phase 4: Content Script 启动与 Heartbeat

目标：

- 每个页面都能稳定上报状态，并接受 background 调度

文件：

- `src/utils/content-bootstrap.ts`
- `src/utils/content-routing.ts`
- `src/entrypoints/*.content.ts`

任务：

- [ ] 重写 content script 公共 bootstrap
- [ ] 页面启动时发送 `HELLO`
- [ ] 页面 ready / focus / visibility / URL 变化时发送 `HEARTBEAT`
- [ ] 定时 heartbeat
- [ ] 实现 `ping` / 状态回报
- [ ] 实现 source send 监听转发
- [ ] 实现目标 prompt 写入与发送

完成标准：

- background 能依赖 content script 获取新鲜页面状态

### Phase 5: Adapter 重构与 DeepSeek 接入

目标：

- 将易变 DOM/URL 逻辑完全收口到 adapter

文件：

- `src/adapters/claude.ts`
- `src/adapters/chatgpt.ts`
- `src/adapters/gemini.ts`
- `src/adapters/deepseek.ts`
- `src/adapters/types.ts`

任务：

- [ ] 定义新的 adapter interface
- [ ] Claude adapter 适配新接口
- [ ] ChatGPT adapter 适配新接口
- [ ] Gemini adapter 适配新接口
- [ ] 新建 DeepSeek adapter
- [ ] 为每个 adapter 实现：
  - `extractSessionId`
  - `isBlankChatUrl`
  - `detectPageState`
  - `onUserSubmit`
  - `setComposerText`
  - `submit`
  - `openNewChat`
  - `waitForSessionRefUpdate`

完成标准：

- 4 个 provider 都可通过统一接口被调度

### Phase 6: Popup 改造

目标：

- popup 从“已注册 tab”视图切换为“workspace 管理”视图

文件：

- `src/entrypoints/popup/App.tsx`

任务：

- [ ] 展示当前 workspace 数量
- [ ] 展示是否已达 2 个上限
- [ ] 展示每个 workspace 绑定了哪些 provider
- [ ] 展示 provider 状态：正常 / stale / 缺失 / 待恢复
- [ ] 支持清空整个 workspace
- [ ] 支持清空单个 provider 绑定
- [ ] workspace 已达上限时提示用户清理

完成标准：

- popup 可作为 workspace 管理入口使用

### Phase 7: 测试与回归验证

目标：

- 至少覆盖核心路由与状态管理逻辑

建议测试类型：

- 单元测试
- 集成测试（以 mock adapter 为主）

任务：

- [ ] 测试 pending workspace 创建与清理
- [ ] 测试 workspaceIndex 路由
- [ ] 测试多 workspace 不串写
- [ ] 测试恢复失败后的 provider 重绑定
- [ ] 测试 workspace 数量上限
- [ ] 测试手动清空 workspace / provider
- [ ] 测试 stale heartbeat 判定

完成标准：

- 核心路由和存储逻辑有自动化覆盖

## 5. 推荐实现顺序

推荐严格按以下顺序推进：

1. `protocol.ts`
2. `storage.ts` / `workspace.ts`
3. `background.ts`
4. `content-bootstrap.ts` / `content-routing.ts`
5. 4 个 adapter
6. popup
7. tests

原因：

- adapter 再脆弱，也不应该阻塞核心路由模型落地
- 先把协议和状态模型站稳，后面 provider DOM 调整成本才低

## 6. 需要用户补充的信息

若进入实现阶段，需要用户补充每个 provider 的以下信息：

- 新对话页 URL 结构
- 已有对话页 URL 结构
- sessionId 在 URL 中的提取规则
- 首条发送后 URL 是否变化
- composer 的稳定 selector
- send button 的稳定 selector
- `New Chat` 按钮或等效入口 selector
- 登录页 / 未就绪页的稳定标记

DeepSeek 尤其需要优先补全这些信息。

## 7. 风险清单

### 风险 1

provider URL 规则变化，导致 `extractSessionId` 失效。

缓解：

- 保存真实 URL
- adapter 层隔离

### 风险 2

发送后 session URL 生成延迟过高，导致 pending 超时。

缓解：

- `waitForSessionRefUpdate` 做合理超时与重试

### 风险 3

页面看似存活，但 composer 尚未 ready。

缓解：

- heartbeat 只作参考
- 写入前必须强校验

### 风险 4

同一 session 多 tab 打开，目标选择不稳定。

缓解：

- `claimedTab` 优先
- heartbeat + 最近聚焦作为回退

## 8. 验收清单

- [ ] 从新对话页发第一条消息可创建 workspace
- [ ] 从不属于任何 workspace 的已有 session 发消息不会触发同步
- [ ] 同一 workspace 支持连续同步
- [ ] 已绑定 provider 支持反向同步
- [ ] 多 workspace 下同一 provider 不串写
- [ ] 目标 tab 丢失后可恢复或重绑定
- [ ] 恢复失败时只同步当前消息
- [ ] workspace 上限为 2，超限时 popup 提示
- [ ] 支持清空整个 workspace
- [ ] 支持清空单个 provider 绑定
- [ ] `pnpm compile` 通过
