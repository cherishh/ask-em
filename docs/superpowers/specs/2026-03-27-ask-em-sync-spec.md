# ask'em 同步功能 Spec

## 1. 目标

ask'em 是一个浏览器扩展，允许用户将同一条 prompt 同步发送到多个 AI chat provider，以便进行并行比较。

本期目标是实现一套：

- 不污染用户已有无关对话
- 支持连续多轮对话
- 支持从任意已绑定 provider 反向同步
- 能从 tab 丢失、service worker 重启、页面冻结中恢复
- 便于替换 provider DOM 逻辑

的同步系统。

初始支持的 provider：

- Claude
- ChatGPT
- Gemini
- DeepSeek

## 1.1 技术基线

建议技术栈：

- WXT
- TypeScript
- React
- Chrome Extension Manifest V3
- `chrome.storage.local` / `chrome.storage.session`

建议最小权限：

- `storage`
- `tabs`

若后续需要更稳定地监听 tab 生命周期或导航，可再评估是否增加：

- `webNavigation`

## 1.2 明确不做的事情

本期不做：

- 历史消息补发
- 附件 / 图片 / 富媒体同步
- 自动合并 workspace
- 将用户已有 session 自动接管为新 workspace
- 响应对比视图

## 2. 核心原则

### 2.1 同步单位是 workspace，不是 tab

一个 `workspace` 表示一组跨 provider 的镜像对话。

workspace 内会记录每个 provider 当前绑定的 conversation。

### 2.2 新 workspace 只能从新对话创建

只有当用户在某个 provider 的【新对话页】发送第一条消息时，插件才允许创建新 workspace。

创建条件必须同时满足：

1. 当前页面被 adapter 判定为 `new-chat`
2. 当前页面还没有真实 `sessionId`
3. 当前 workspace 总数少于 2

如果用户在一个【已有 session】中发送消息，且该 session 不属于任何 workspace：

- 不创建 workspace
- 不做同步

### 2.3 已绑定 session 支持双向同步

一旦某个 provider 的 session 已经绑定到某个 workspace 中：

- 用户从该 session 继续发送消息
- 插件应识别出其所属 workspace
- 并向该 workspace 的其他 provider 成员继续同步

因此 workspace 内的 provider 成员是对等的，不存在固定的主从关系。

### 2.4 不污染用户无关对话

只有以下两类页面允许被插件自动写入：

1. 当前页面正好是某个 workspace 已绑定的 conversation
2. 当前页面是 blank/new-chat 页面，且该 provider 尚未加入该 workspace，正处于初始化阶段

除此之外，一律不得写入。

### 2.5 恢复失败时不补历史

如果某个 provider 既有绑定会话无法恢复：

- 新建一个 blank/new-chat 会话
- 只发送当前消息
- 不补历史
- 后续从新的会话继续同步

### 2.6 最多保留 2 个 workspace

系统最多只保留最近 2 个 workspace。

当数量达到 2 时：

- 不自动淘汰旧 workspace
- 不自动创建第 3 个 workspace
- popup 必须明确提示用户先清理旧 workspace

### 2.7 支持手动清理

popup 必须支持：

1. 清空整个 workspace
2. 清空某个 workspace 下某个 provider 的绑定

## 3. 关键概念

### 3.1 Provider

```ts
type Provider = 'claude' | 'chatgpt' | 'gemini' | 'deepseek';
```

### 3.2 ConversationRef

```ts
type ConversationRef = {
  provider: Provider;
  sessionId: string | null;
  url: string;
};
```

约束：

- `sessionId` 是 conversation 的首选稳定标识
- `url` 用于恢复、导航和最终校验
- `sessionId: null` 只允许出现在首次发送后的短暂 pending 阶段

### 3.3 Workspace

```ts
type Workspace = {
  id: string;
  members: Partial<Record<Provider, ConversationRef>>;
  enabledProviders: Provider[];
  createdAt: number;
  updatedAt: number;
};
```

说明：

- `members[provider]` 表示该 workspace 在某个 provider 上已绑定的 conversation
- `enabledProviders` 表示当前该 workspace 希望同步到哪些 provider

### 3.4 WorkspaceIndex

```ts
type WorkspaceIndex = Record<string, string>;
```

Key 格式：

```ts
`${provider}:${sessionId}`
```

作用：

- 将某个 provider 的某个 session 反查到所属 workspace
- 支撑连续同步与反向同步

### 3.5 ClaimedTab

```ts
type ClaimedTab = {
  provider: Provider;
  workspaceId: string;
  tabId: number;
  lastSeenAt: number;
  pageState: 'ready' | 'login-required' | 'not-ready';
  currentUrl: string;
};
```

说明：

- `claimedTab` 是运行时缓存，不是持久真相
- 它表示“当前优先使用哪个 tab 承载某个 workspace 在某个 provider 上的会话”
- 如果它丢失，不影响 correctness，系统仍可根据 workspace 中保存的 URL/session 恢复

### 3.6 lastSeenAt

`lastSeenAt` 表示某个 claimed tab 最近一次被 content script 正常确认存活的时间。

用途：

- 从多个候选 tab 中选择较新的那个
- 判断 claimed tab 是否 stale
- 判断 frozen/discarded 后是否还值得继续复用
- popup 展示“正常 / stale / 待恢复”

## 4. 路由与身份模型

### 4.1 conversation 身份以 `provider + sessionId` 为核心

插件识别一个 conversation 是否属于某个 workspace，主要依赖：

- provider
- sessionId

`sessionId` 通常由当前 URL 提取。

### 4.2 恢复优先使用真实 URL

首次绑定某个 provider 会话成功后，必须保存当时真实访问到的完整 URL。

后续恢复优先级：

1. 优先打开保存的完整 URL
2. 只有在必要时，才使用 provider 特定逻辑根据 `sessionId` 生成 URL

### 4.3 多 workspace 不串写

只要严格按 `provider + sessionId -> workspaceId` 路由，同一 provider 下多个 workspace 不会误同步。

例：

- `gemini:g1 -> W1`
- `gemini:g2 -> W2`
- `chatgpt:c9 -> W1`
- `chatgpt:c20 -> W2`

当 source 是 `gemini:g1` 时：

- 只能命中 `W1`
- 只能向 `W1.members` 中的目标成员写入

## 5. 状态存储

### 5.1 chrome.storage.local

保存持久状态：

```ts
type LocalState = {
  globalSyncEnabled: boolean;
  workspaces: Record<string, Workspace>;
  workspaceIndex: WorkspaceIndex;
};
```

### 5.2 chrome.storage.session

保存运行时状态：

```ts
type SessionState = {
  claimedTabs: Record<string, ClaimedTab>;
};
```

Key 格式：

```ts
`${workspaceId}:${provider}`
```

## 5.3 消息协议

background 与 content script 至少需要以下消息：

```ts
type Provider = 'claude' | 'chatgpt' | 'gemini' | 'deepseek';

type HelloMessage = {
  type: 'HELLO';
  provider: Provider;
  currentUrl: string;
  sessionId: string | null;
  pageState: 'ready' | 'login-required' | 'not-ready';
};

type HeartbeatMessage = {
  type: 'HEARTBEAT';
  provider: Provider;
  currentUrl: string;
  sessionId: string | null;
  pageState: 'ready' | 'login-required' | 'not-ready';
  visibilityState: DocumentVisibilityState;
  timestamp: number;
};

type UserSubmitMessage = {
  type: 'USER_SUBMIT';
  provider: Provider;
  currentUrl: string;
  sessionId: string | null;
  pageKind: 'new-chat' | 'existing-session';
  content: string;
  timestamp: number;
};

type DeliverPromptMessage = {
  type: 'DELIVER_PROMPT';
  workspaceId: string;
  provider: Provider;
  content: string;
  expectedSessionId: string | null;
  expectedUrl: string | null;
  timestamp: number;
};

type PingMessage = {
  type: 'PING';
};

type PingResponseMessage = {
  type: 'PING_RESPONSE';
  provider: Provider;
  currentUrl: string;
  sessionId: string | null;
  pageState: 'ready' | 'login-required' | 'not-ready';
};

type GetStatusMessage = {
  type: 'GET_STATUS';
};

type ClearWorkspaceMessage = {
  type: 'CLEAR_WORKSPACE';
  workspaceId: string;
};

type ClearWorkspaceProviderMessage = {
  type: 'CLEAR_WORKSPACE_PROVIDER';
  workspaceId: string;
  provider: Provider;
};
```

协议原则：

- `USER_SUBMIT` 只表示用户真实发送，不表示 background 广播
- `DELIVER_PROMPT` 只由 background 发给目标 provider 页面
- 写入前要基于 `expectedSessionId` / `expectedUrl` 做强校验
- popup 只通过 `GET_STATUS` 和清理类消息与 background 交互

## 6. workspace 创建规则

### 6.1 允许创建的唯一入口

用户在某个 provider 的【新对话页】发送第一条消息，且：

1. 当前页面为 `new-chat`
2. 当前还没有真实 `sessionId`
3. 当前 workspace 数量小于 3

此时允许创建 pending workspace。

### 6.2 不允许创建的情况

如果当前页面已有真实 `sessionId`，则：

- 若 `provider + sessionId` 已存在于 `workspaceIndex`，继续使用已有 workspace
- 若不存在于 `workspaceIndex`，不创建 workspace，不做同步

## 7. pending 机制

pending 只用于首次创建 workspace 时，真实 source session 尚未生成的短暂阶段。

流程：

1. 用户在 `new-chat` 页面发送第一条消息
2. 创建 pending workspace
3. source member 暂记为：

```ts
{ provider, sessionId: null, url }
```

4. adapter 在发送后等待真实 URL/sessionId 出现
5. 一旦出现，更新 `workspace.members` 与 `workspaceIndex`

清理条件：

- source tab 被关闭
- source sessionId 仍未生成
- 没有任何目标 provider 完成绑定

以及超时清理：

- 超过 30 秒仍未完成 source session 绑定，则自动清理

## 8. 写入安全规则

对某个目标 provider 写入时，必须满足以下任一条件：

### 条件 A

当前目标 tab 展示的就是该 workspace 在该 provider 上已绑定的 conversation。

也就是：

- 当前 URL 提取到的 `sessionId` 与 `workspace.members[provider]` 匹配

### 条件 B

该 provider 尚未加入 workspace，且当前 tab 是 blank/new-chat 初始化页。

### 其他情况

一律不直接写入。

允许的动作：

1. 导航到该 workspace 已记录的目标 URL
2. 或新开一个 tab

导航只用于：

- 已存在该 `workspace + provider` 的可复用执行 tab
- 只是它当前不在正确页面

新开 tab 用于：

- 没有 claimed tab
- claimed tab 失效
- 导航失败
- 当前打开的是用户无关页面
- 或该 provider 尚未加入 workspace，需要初始化

## 9. 核心时序

### 9.1 首次同步

例：

- 用户在 Gemini 新对话页发送 `HI`

流程：

1. 判定当前是 `new-chat`
2. 当前无真实 sessionId
3. 当前 workspace 数量 < 3
4. 创建 pending workspace `W1`
5. Gemini 发送后拿到 `g1`
6. `W1.members.gemini = g1`
7. 对 ChatGPT / Claude / DeepSeek：
   - 打开或复用 blank/new-chat
   - 写入当前消息
   - 等待生成真实 session
   - 绑定到 `W1`

### 9.2 连续同步

例：

- 用户继续在 Gemini 的 `g1` 中发下一条消息

流程：

1. 通过 `gemini:g1` 找到 `W1`
2. 对 ChatGPT，目标会话应为 `c9`
3. 如果 ChatGPT 侧 claimed tab 已在 `c9`，直接写入
4. 否则导航到 `c9.url` 或重新打开 `c9`
5. 写入当前消息

说明：

- source tab 仍是 Gemini 的 `g1`
- `c9` 指的是 ChatGPT 侧的目标执行 tab

### 9.3 反向同步

例：

- 用户改为在 ChatGPT 的 `c9` 中继续聊

流程：

1. 解析出 `chatgpt:c9`
2. 通过 `workspaceIndex` 找到 `W1`
3. 向 `W1` 的其他 provider 成员继续同步

### 9.4 目标恢复

例：

- ChatGPT 的 `c9` tab 被关闭或 discard
- 用户又在 Gemini 的 `g1` 中发消息

流程：

1. 找到 `W1`
2. 目标 ChatGPT 应该对应 `c9`
3. 若 claimed tab 已失效，尝试重新打开 `c9.url`
4. 等待页面 ready
5. 重新校验当前 URL/sessionId 是否仍为 `c9`

若成功：

- 正常写入当前消息

若失败：

1. 新建 blank/new-chat
2. 只发送当前消息
3. 生成新会话 `c10`
4. 更新 `W1.members.chatgpt = c10`
5. 更新 `workspaceIndex`

## 10. 恢复失败判定

尝试恢复某个既有 conversation 时，按以下流程判定：

1. 打开保存的 URL
2. 等待 content script 握手
3. 等待页面进入 `ready`
4. 读取当前 URL，并提取 `sessionId`
5. 检查是否仍与预期 sessionId 一致

满足以下任一条件，则判定恢复失败：

1. 页面跳到登录页
2. 超时后仍无可用 composer
3. 当前 URL 提取不出 sessionId
4. 当前 sessionId 不等于预期值
5. 页面落到 blank/new-chat、首页、404 或错误页
6. 与该 tab 的通信连续失败

## 11. 多 tab 同 session 的选择规则

当同一 provider 同时打开多个展示同一 session 的 tab 时：

只选择一个“主执行 tab”。

优先级：

1. 如果已有 `claimedTab` 且仍有效，优先用它
2. 否则选 heartbeat 最新的匹配 tab
3. 若无 heartbeat，选最近被聚焦过的匹配 tab
4. 仍无法判断时，选 `tabId` 最大的一个

规则：

- 同一时刻，一个 `workspace + provider` 只允许一个自动写入目标 tab
- 其他同 session tab 一律忽略

## 12. Heartbeat 设计

heartbeat 不是 correctness 的唯一来源，而是轻量状态上报机制。

作用：

- 更新 `claimedTab.currentUrl`
- 更新 `claimedTab.lastSeenAt`
- 更新 `pageState`
- 帮助发现 stale tab
- 支撑 popup 状态展示

发送时机建议：

1. content script 启动后发送一次 `HELLO`
2. 页面首次进入 `ready`
3. URL 发生变化
4. `visibilitychange`
5. `focus`
6. 固定时间间隔，例如每 20 到 30 秒一次

heartbeat 建议包含：

```ts
type HeartbeatMessage = {
  type: 'HEARTBEAT';
  provider: Provider;
  currentUrl: string;
  sessionId: string | null;
  pageState: 'ready' | 'login-required' | 'not-ready';
  visibilityState: DocumentVisibilityState;
  timestamp: number;
};
```

stale 判定建议：

- `now - lastSeenAt > 45~60s`

写入前仍需做一次强校验：

1. `ping` content script
2. 再次确认 `pageState`
3. 再次确认 `currentUrl/sessionId`
4. 通过后再写入

## 13. frozen / discarded / stale 处理

系统不需要严格区分浏览器底层究竟是 frozen 还是 discarded。

业务上只需回答：

- 当前目标页面能否被安全写入？

处理原则：

1. `lastSeenAt` 过旧，先标记 stale
2. 写入前先 `ping`
3. 若 `ping` 超时、通信失败、或 `pageState` 不正确，则视为当前不可用

恢复优先级：

1. 如果 tab 还存在，尝试把它带回正确会话页并等待重新握手
2. 若失败，重新打开保存的 conversation URL
3. 若仍拿不到预期 sessionId，则恢复失败
4. 恢复失败后新建 blank/new-chat，只同步当前消息，并重绑定该 provider

## 14. Popup 要求

popup 至少必须展示：

1. 当前 workspace 数量
2. 是否已达到 2 个上限
3. 每个 workspace 当前绑定了哪些 provider
4. 每个 provider 绑定是否正常、stale、缺失或需要重建

popup 必须支持：

1. 清空整个 workspace
2. 清空某个 workspace 下某个 provider 的绑定

## 15. Adapter 最小接口

```ts
interface SiteAdapter {
  name: Provider;

  getCurrentUrl(): string;
  extractSessionId(url: string): string | null;
  isBlankChatUrl(url: string): boolean;
  detectPageState(): 'ready' | 'login-required' | 'not-ready';

  onUserSubmit(callback: (content: string) => void): () => void;

  setComposerText(content: string): Promise<void> | void;
  submit(): Promise<boolean> | boolean;

  openNewChat(): Promise<boolean>;
  waitForSessionRefUpdate(previousUrl?: string): Promise<ConversationRef | null>;
}
```

adapter 必须负责：

- 识别是否是新对话页
- 从 URL 提取 sessionId
- 打开新对话
- 判断页面 ready
- 首次发送后等待真实 session URL 出现

adapter 不负责：

- workspace 路由
- 跨 provider 同步
- 存储与持久化

## 16. 验收标准

满足以下条件，则认为实现符合本 spec：

1. 只有从新对话页发起的首条消息才能创建 workspace
2. 已有 session 若不属于任何 workspace，则不会被自动同步
3. 同一 workspace 内，任意 provider 上的后续对话都能反向同步
4. 不会误写入用户无关对话
5. 多个 workspace 下，同一 provider 不会串写
6. 恢复失败时只同步当前消息，不补历史
7. workspace 最多保留 2 个，超限时明确提示用户
8. 支持手动清空整个 workspace 或单个 provider 绑定
