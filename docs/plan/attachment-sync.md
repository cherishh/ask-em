# Attachment Sync — Design Rationale

> 这是设计 rationale + 边界目录 + 协议细节。**actionable 的 phase 清单与验收在 `todo.md`**，本文不重复，避免漂移。

## Goal

当用户提交带附件的 prompt 时，把附件和文本一起投递到同一 workspace 里每个启用的 provider。

当前链路只携带 `content: string`。附件要成为 submit → fan-out → deliver 协议的一等成员，并有严格生命周期，保证二进制数据不超出其投递窗口存活。

## Non-Goals

- v1 不硬编码 image-only。source / store / protocol 走通用 `File`，实际放行类型由每个 provider 的 `uploadCapability` 决定（图片 + 已验证的 PDF/DOCX 等文档）。
- 不重写用户当纯文本粘贴的远程 URL；只有 `DataTransfer.files` 真正产出附件。
- 不复用 provider 服务端已存文件句柄；每个 target 各自上传。
- 不劫持 provider 自己的 XHR 上传。
- 不跨浏览器 session 持久化附件。
- 不做格式转换、压缩、远程 fetch、same-file dedupe。

## Current State（text-only 链路）

- `runtime/messages.ts` 的 `UserSubmitMessage` / `DeliverPromptMessage` 只有 `content: string`。
- `adapters/types.ts` 的 composer 是 `setComposerText(content)` / `subscribeToUserSubmissions(onSubmit: (content) => void)`。
- `adapters/factory.ts` 在 `keydown`(Enter) 和 send-button `click` 上读 `getEditableText` 观察提交——**两条路径都会 fire**，1500ms 去重窗就是为此存在。
- `adapters/dom.ts` 用 `execCommand('insertText')` 写文本，无法承载二进制。
- `content/submit-fingerprint.ts` 用 `${currentUrl}::${content}` 做指纹。
- workspace 在 background `handleUserSubmit` → `prepareSubmitWorkspaceContext` 才解析/创建；content 提交时**没有 workspaceId**。

## Key Design Decisions

### 1. 二进制传输：base64 on wire，raw at rest

`chrome.runtime.sendMessage` 的序列化**不能可靠承载** `File`/`Blob`/`ArrayBuffer`/`Uint8Array`（跨进程 + 历史 JSON 语义 + Blob 引用语义，版本行为不一）。结论：

- **wire**：附件 bytes 一律 base64 chunk，且**只允许**出现在 `ATTACHMENT_APPEND_CHUNK` / `ATTACHMENT_READ_CHUNK`。禁止进 `USER_SUBMIT`/`DELIVER_PROMPT`、`chrome.storage` metadata、debug log。
- **at rest**：IndexedDB 原生支持 `Blob`/`ArrayBuffer`（structured clone），**落盘存 raw bytes，不经 base64，无膨胀**。预算以 raw bytes 计。
- **瞬时内存**：base64 膨胀 ~33%（UTF-16 字符串实占约 2×），且每个 target 各自重读一遍 → ×N 搬运。接收端必须**增量解码**（逐 chunk append 成 Blob parts / 累积 Uint8Array），不要先拼巨型 base64 再整体 decode。

这条把膨胀约束在最短的瞬时窗口，是处理二进制的通用形态。

### 2. 预算与上限（含本轮调整）

| 量 | 值 | 说明 |
|---|---|---|
| 每 submit 文件数 | `ATTACHMENT_MAX_COUNT = 20` | provider 更低者由 capability gate 收紧 |
| **单文件** | **`ATTACHMENT_MAX_FILE_BYTES = 25 MB`** | 新增。压瞬时内存峰值 + 贴合 provider 实际限制 |
| **总 in-flight raw** | **`ATTACHMENT_SESSION_BUDGET_BYTES = 50 MB`** | 从 100MB 下调（base64 wire 膨胀 + ×N 重复搬运放大瞬时压力）；可调旋钮 |
| TTL | `ATTACHMENT_MAX_AGE_MS = 10 min` | |
| chunk | `ATTACHMENT_CHUNK_BYTES ~256KB` | raw 计，base64 后 ~1.33× |

超数量 / 超单文件 / 超总预算 → 跳过附件 fan-out + indicator 提示，**不阻断源 provider 原生发送**。单文件在 25MB 内但某 provider 自身拒绝（大小/格式）→ 原生失败 → `delivery-failed` / `upload failed`。

### 3. 生命周期：submitId 作用域，不做 per-delivery 引用计数

一个附件的 bytes 被同一 submit 的**所有 target 共享**——任何单个 delivery 完成都不能释放（其他 target 还要读）。所以「最后一个 target 完成」≡「该 submit fan-out 完成」≡ 按 submitId 删除。`pendingDeliveryIds` 引用计数本质就是在重算这个等价物，却是最易泄漏的簿记（漏 release / double release / release-after-force-delete 竞态）。

v1 用**作用域绑定生命周期**替代引用计数：

- release 挂在 **`handleUserSubmit` 的 outer finally**，按 `submitId` 删光该 submit 的全部附件（metadata + IndexedDB bytes），无论成败。**必须是最外层**：`handleUserSubmit` 在 fan-out（`deliverPromptToWorkspaceTargets`，`delivery.ts:160`）之前有三处早退——无 workspace（:100）、provider disabled（:119）、global sync paused（:147）。把 finally 放进 fan-out 内层会漏掉这三条路径，泄漏已 finalize 的附件到 TTL。
- `ATTACHMENT_ABORT(submitId)`：source 捕获写入失败/取消/卸载时即时释放，不等 TTL。
- TTL sweep（**create-time** + startup）兜 SW 崩溃 / 残留。
- delete 必须 idempotent，容忍并发已删。

这不削弱任何硬约束：字节"多活"的窗口被 50MB 预算 + create-time sweep + 10min TTL 三重兜住。

### 4. staging owner-binding

生命周期要求 metadata 有 `ownerWorkspaceId` / `submitId`，但 source 在 submit 时还没 workspaceId（background 才解析；new-chat 首次提交时 workspace 还不存在）。所以：

- content 过 dedupe 后铸 `submitId`（唯一 handle），`ATTACHMENT_CREATE` 带 `submitId + name/mime/size` 建 **staging** 条目。
- `ownerTabId` 由 background 从 `sender.tab?.id` 写入，不信任 message payload（合现有约定 `delivery.ts:79`，避免 tab 身份伪造/误传）。
- background 在 `handleUserSubmit` 解析出 workspace 后 `bindAttachments(submitId, workspaceId)` 回填 owner。
- release / abort / cleanup 全部以 `submitId` 为 handle；`AttachmentRef.id` 仍是落库 key。未 bind 的 staging 条目也能被 submitId 定位清理；TTL 兜底。

### 5. 写入/发送时序

- **dedupe 先于 store 写入**：store 写入插在 `submit-controller.ts` 去重之后（`rememberSubmitFingerprint` 后）、发 `USER_SUBMIT` 之前。否则 keydown+click 双触发会在 dedupe 拦下前产生双写。
- **capture-time 稳定 id**：附件 id 在 capture 时分配、留在 buffer 直到清空，不在每次 onSubmit 重新生成——保证双触发同指纹、可被 dedupe 折叠。
- **`USER_SUBMIT` 等 finalize**：所有 ref `status=ready` 后才发；`readAttachmentChunks` 对非 ready 明确失败，杜绝 target 读半截。
- **budget reserve-on-create**：budget = 未释放条目声明 size 之和，create 时 check+reserve（SW 单线程串行 → 原子）。
- **sweep 在 reserve 之前**：预算入口是 `ATTACHMENT_CREATE`，所以 expired sweep 必须先于每次 create 的 reserve，否则过期附件会卡死 create 预算、source 发不出 USER_SUBMIT。USER_SUBMIT 前 sweep 只是次要入口。

### 6. Source capture：四入口 + transient hook

观察用户附文件的全部现实路径：

1. `paste`：`ClipboardEvent.clipboardData.files`（截图、图片查看器复制）。
2. `drop`：`DragEvent.dataTransfer.files`（OS / 其他 tab 拖入）。
3. 稳定 `<input type="file">` 的 `change`（上传按钮）。
4. Manus 类 **transient detached input**：provider 临时 `createElement('input')` + `.click()` 后从不挂到 document，普通 document-level `change` 监听抓不到——需要 narrow / idempotent / 可 teardown 的 **MAIN-world hook**，只观察 `input[type=file]`，并经受控 bridge（候选 `window.postMessage` structured-clone `File[]`）把 File 交回 isolated content。

file input capture 用 document-level capture + provider-specific scoping（toolbar sibling / 隐藏 input 也要抓，但不能把无关页面 input 当 composer 附件）。

不特殊处理 HTML-with-inline-image 粘贴：这些 composer 实测只保留纯文本，ask'em 镜像该原生行为，不解析 `<img>`。

### 7. Target delivery：per-provider DOM replay

优先级：synthetic `paste`（ProseMirror/React composer）→ composer 子树内 `<input type=file>` 注入 → transient input（菜单触发后捕获）。不依赖 synthetic `drop`（构造的 DragEvent 不等价真实 OS 拖放，易被页面拦截）。

adapter 必须能完全 override payload 顺序（Manus 可能 attach-first）。

**submit 前 baseline+delta 正向确认**：很多 provider 只要有文本 send button 就 enable，注入静默失败时会把附件丢成纯文本却上报成功——这是 silent data loss。`detectAttachmentUploadError` 只测"上传出错"，测不到"上传没发生"，所以需要正向确认。adapter 暴露 `getComposerAttachmentPresence()`（count 或 preview-key 集合）；delivery controller 注入前快照 baseline、注入后比 **delta** 是否等于本次 refs。只看绝对 count 会被 target 已有草稿/旧 preview 误判（baseline=1 + 注入 2 但只落 1 → count=2 假通过）。filename/preview-key 精确匹配为 per-adapter 可选强化。

附件场景把 send button 等待窗口延长到约 30s，期间轮询 `detectAttachmentUploadError()`。explicit error 与 timeout 都映射 `delivery-failed`，文案 `upload failed`。

### 8. Capability gate

```ts
type UploadCapability = {
  maxFiles: number;
  allowImages?: boolean;
  allowPlainText?: boolean;
  documentMimes?: string[];
  documentExtensions?: string[];
  blockedMimes?: string[];
  blockedMimePrefixes?: string[];
  blockedExtensions?: string[];
} | null; // null = 不支持附件
```

- source 侧读取附件 bytes 时做轻量 text sniff，并在 `AttachmentRef.isPlainText` 里记录“实际看起来是文本”。
- 判定：先按 MIME/extension blacklist 拒绝音视频、压缩包、可执行、字体等；再允许图片、常见文档、`isPlainText === true`、或明确的文本 MIME/extension。
- `isPlainText === false` 且不属于图片/常见文档/文本 MIME-extension → `unsupported-attachment`。
- count 超 `min(ATTACHMENT_MAX_COUNT, maxFiles)` → `unsupported-attachment`。
- **mixed all-or-nothing**：一次 submit 多附件中只要有一个该 target 不接受，整单失败 `unsupported-attachment`，不静默只发部分。
- gate 在 background delivery 步骤；不支持只标记该 provider，不影响 fan-out 其他 provider，不重试。
- `unsupported-attachment` 的 presentation helper 与 gate **同批**完成（否则 issue 已产、UI 解释不了）。

### 9. Fingerprint with attachments

```
fingerprint = `${currentUrl}::${content}::${attachmentIds.sort().join(',')}`
```

attachmentIds 用 capture-time 稳定 id，保证"同文本不同附件"不被误折叠，"同一次提交的双触发"被正确折叠。

## Protocol Changes

### `runtime/types.ts`

```ts
export type AttachmentRef = {
  id: string;     // metadata + blob 的 key
  name: string;   // 原文件名，给 provider UI
  mime: string;
  size: number;
};

export type CapturedAttachment = {
  file: File;
  name: string;   // 浏览器/provider 给空名时合成
  mime: string;   // 从 file.type 或扩展名推断
  size: number;
  source: 'paste' | 'drop' | 'file-input' | 'transient-file-input';
};

export type WorkspaceIssue =
  | 'needs-login' | 'loading' | 'delivery-failed' | 'error-page'
  | 'unsupported-attachment'; // new
```

> 注意：`AttachmentRef` **不含 sha256**——v1 无消费者（不做 dedupe，指纹用 id，同进程 IndexedDB 完整性风险低）。

### `runtime/messages.ts`

- `UserSubmitMessage` / `DeliverPromptMessage` 各加 `attachments: AttachmentRef[]`（恒在，text-only 为空数组）。`UserSubmitMessage` 另加 `submitId`（content 过 dedupe 后铸，贯穿 create/bind/release 的唯一 handle）。
- 新增传输消息：`ATTACHMENT_CREATE`、`ATTACHMENT_APPEND_CHUNK`（base64）、`ATTACHMENT_FINALIZE`、`ATTACHMENT_READ_CHUNK`（base64）、`ATTACHMENT_ABORT`。

### `adapters/types.ts`

- `subscribeToUserSubmissions?(onSubmit: (payload: { text; attachments: CapturedAttachment[] }) => void)`。
- `setComposerPayload?({ text, attachments })`：渐进替代 `setComposerText`；adapter 可自定 text/attachment 顺序。
- `detectAttachmentUploadError?(): string | null | Promise<...>`（TODO stub，smoke test 补）。
- `getComposerAttachmentPresence?(): { count: number; keys?: string[] }`：报告当前 composer 附件 presence，供 controller 做 baseline+delta 确认。
- `ProviderAdapter.uploadCapability?: UploadCapability`。

### `runtime/attachment-store.ts`（新）

background-owned，`chrome.storage.session` metadata + IndexedDB raw bytes。函数约：`createAttachment`（staging + reserve，**先 sweepExpired**，owner 取 `sender.tab?.id`）、`appendChunk`、`finalize`、`bindAttachments(submitId, workspaceId)`、`readChunks`、`releaseSubmit(submitId)`、`abort(submitId)`、`sweepExpired`、`sweepByOwnerTab(tabId)`、`clearAll`、`getReservedBytes`。

## Edge Cases

### Must handle

1. provider 无 `uploadCapability` → `unsupported-attachment`，跳过，不重试。
2. blacklist 命中，或无法证明是图片/常见文档/实际文本 → `unsupported-attachment`，不做格式转换。
3. **mixed 附件部分不支持** → 该 target 整单 `unsupported-attachment`，不发部分。
4. 超总预算 / 超单文件 25MB / 超 20 数量 → 写 store 前跳过附件 fan-out + 提示，不阻断原生发送。
5. 单文件在限内但 provider 原生拒绝 → `detectAttachmentUploadError` / timeout → `delivery-failed`，文案 `upload failed`。
6. delivery 抛错/超时 **或 `handleUserSubmit` 早退**（无 workspace / provider disabled / sync paused）→ outer finally 仍按 submitId 删除，store 不漏。写入失败/取消 → `ATTACHMENT_ABORT` 即时释放；source tab 关闭只提前清 `status=writing` 且未 bind 的 staging 条目，ready 条目交给 submit lifecycle / TTL，避免 USER_SUBMIT→bind 窗口误删。
7. 文本紧随图片 submit → 上一批附件在 fan-out 完成时已删（release 绑 deliver 完成，不绑下次 submit）。
8. 程序注入反射成用户输入 → target 的 suppression 必须在**任何**注入前开启（synthetic paste / stable input change / transient input change）。
9. **注入静默失败** → `getComposerAttachmentPresence()` 的 baseline+delta 确认不足 → 不发送、`delivery-failed`，杜绝"附件丢成纯文本却报成功"。
10. 指纹碰撞 → attachmentIds 进指纹。
11. **用户删附件（submit-time 为准）**：capture buffer 只缓存 `File` bytes 来源；发送前一刻读取 source composer DOM 的 attachment card/preview 作为当前附件真相源，过滤 captured files。无法确认当前附件或无法唯一匹配 → 本次跳过附件 fan-out，不同步旧 buffer。仅影响 ask'em fan-out，不挡原生发送。
12. 源上传未完成用户已回车 → capture 在 paste/drop/change 时拿到 raw File，不依赖源 provider 上传完成。

### Secondary

13. 动画 GIF/WebP 一家接受一家拒绝 → capability gating，无客户端转换。
14. 同图 attach 两次 → 存两份，按各自 id 独立删除。
15. SW restart mid-fan-out → TTL/startup sweep 清残留；orphan blob（无 metadata）startup 删除。
16. IndexedDB 写失败/配额超 → 同超预算处理：跳过 fan-out，移除该附件的部分 chunk。
17. dev "Clear persistent storage" → 同时清 session metadata + IndexedDB object store。
18. mixed 文本+内联 `<img>` 粘贴 → 跟随 provider 原生行为（实测只取文本），不解析。

### Out of scope (v1)

- 远程 `<img>` URL（`text/uri-list` 无 `files`）当 text-only。
- 跨 provider 格式转换、客户端压缩。

## Guardrails

- 不记录二进制 payload / base64 / dataURL / 完整 filename。
- base64 只出现在 `ATTACHMENT_APPEND_CHUNK` / `ATTACHMENT_READ_CHUNK`。
- 不在主协议塞 inline 二进制——ref 间接层是重点。
- 不写没有 TTL / 没有 release 路径的附件。
- target submit 前必须通过 `getComposerAttachmentPresence()` 做 baseline+delta 确认，不静默降级为纯文本。
- 不引入 `chrome.alarms` 或其他新权限（manifest 现有 `storage`/`tabs`）。
- 不阻止源 provider 原生发送。

## Open Questions

- 总预算 50MB 是否需做成可配置？提案：v1 固定，留常量便于调。
- 是否给用户"此附件将发往 N 个 provider"的预提交预览？提案：v1 不做。
