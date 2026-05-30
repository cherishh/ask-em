# 附件同步 TODO

> 权威操作计划。深层设计 rationale、边界目录、协议细节见 `docs/plan/attachment-sync.md`。
> 本轮已并入两份 review 的合并结论（标注 [P1]/[A*]/[B*]）与两条新预算约束（单文件 25MB、总预算 50MB）。

## 目标

让 ask'em 在用户提交带附件的 prompt 时，把附件和文本一起同步到同一 workspace 里的所有启用 provider。

当前链路只传 `content: string`。新链路把附件作为一等数据，但二进制内容不长期保存，必须有明确生命周期和 GC。

## 不做

- v1 不硬编码为 image-only，也不维护 file type allowlist/blacklist。source/store/protocol 支持通用 `File` 附件，具体类型是否可上传交给目标 provider 原生判断；ask'em 只传递失败状态给用户。
- 不处理纯文本里的远程文件/图片 URL。
- 不复用某 provider 已上传成功的服务端文件句柄；每个 target provider 各自上传一次。
- 不劫持 provider 自己的 XHR 上传。
- 不跨浏览器 session 持久化附件。
- 不做附件格式转换、压缩、远程文件 fetch。
- 不做 same-file dedupe。
- **不依赖隐式 structured-clone 传二进制**（见下「二进制传输契约」）。

## 核心决策

- Source capture 覆盖 4 类入口：`paste`、`drop`、稳定 DOM `input[type=file]`、Manus/Gemini 这类 transient detached file input。
- File input capture 不能只看 composer subtree；用 document-level capture，再用 provider-specific scoping 判断是否属于当前 composer。
- MAIN-world transient input hook 必须 narrow、idempotent、可 teardown，只观察 `input[type=file]`，并通过受控 bridge 把文件交回 isolated content script。
- ask'em v1 不阻止源 provider 原生发送。capture 失败、超预算/超限、submit-time source snapshot 无法确认当前附件时，只跳过附件 fan-out 并提示 indicator。
- Target fan-out 不依赖 synthetic drop。drop 只用于 source capture。
- Adapter 必须能控制 payload 顺序；默认 text-first。Manus 现场验证后也走 text-first，附件注入细节仍留在 Manus adapter。
- **预算与上限（本轮调整）**：
  - 每次 submit 最多 `20 files`（`ATTACHMENT_MAX_COUNT`）。
  - **单文件 ≤ `25 MB`（`ATTACHMENT_MAX_FILE_BYTES`，新增）**。超过则跳过附件 fan-out + 提示 `attachment too large`，不阻断原生发送。
  - **总 in-flight raw budget = `50 MB`（`ATTACHMENT_SESSION_BUDGET_BYTES`，从 100MB 下调；可调旋钮）**。理由：base64 wire 膨胀 ~33% + 每个 target 重复搬运（×N）放大瞬时内存/CPU，不是落盘膨胀。
  - provider 自身更低的数量限制由 capability gate 收紧；格式限制不在 ask'em 侧预判。
- 单文件在 25MB 以内、但某 provider 自己拒绝（大小/格式）→ 原生上传失败 → 统一映射 `upload-failed`，文案 `upload failed`。
- **生命周期以 submitId 作用域，不做 per-delivery 引用计数 [B2]**（详见「生命周期硬约束」）。

## 二进制传输契约 [P1-a]（新增，执行前必须先定）

- `chrome.runtime.sendMessage` 不能可靠承载 `File`/`Blob`/`ArrayBuffer`/`Uint8Array`。**附件 bytes 在 wire 上一律用 base64 chunk 编码**。
- **base64 只允许出现在 `ATTACHMENT_APPEND_CHUNK` / `ATTACHMENT_READ_CHUNK` 这两类传输消息里**；禁止进主协议（`USER_SUBMIT`/`DELIVER_PROMPT`）、`chrome.storage` metadata、debug log。
- **至 rest 存 raw bytes**：IndexedDB 原生支持 `Blob`/`ArrayBuffer`（structured clone），落盘不经 base64，无膨胀。预算 `ATTACHMENT_SESSION_BUDGET_BYTES` 以 raw bytes 计。
- 接收端**增量解码**（chunk 逐块 append 成 `Blob` parts / 累积 `Uint8Array`），不要先拼成一个巨大 base64 字符串再整体 decode，以压低瞬时内存峰值。
- `ATTACHMENT_CHUNK_BYTES` 以 raw bytes 定义（建议 ~256KB），base64 后约 1.33× 上线。

## 类型和协议

- [ ] 新增 `AttachmentRef`（**砍掉 sha256 [B1]**，v1 无消费者）：
  - `id`
  - `name`
  - `mime`
  - `size`
- [ ] 新增 `CapturedAttachment`：
  - `file: File`
  - `name`
  - `mime`
  - `size`
  - `source: 'paste' | 'drop' | 'file-input' | 'transient-file-input'`
- [ ] `UserSubmitMessage` 增加 `attachments: AttachmentRef[]`（text-only 为空数组）+ `submitId`（content 过 dedupe 后铸的唯一 handle，贯穿 staging create、bind、release [R2-P1-2]）。
- [ ] `DeliverPromptMessage` 增加 `attachments: AttachmentRef[]`，text-only 时为空数组。
- [ ] `WorkspaceIssue` 增加 `unsupported-attachment` / `attachment-limit` / `upload-failed`。
- [ ] `ProviderAdapter` 增加 `uploadCapability?: UploadCapability`。
- [ ] `ProviderComposerAdapter` 增加 `setComposerPayload?({ text, attachments })`。
- [ ] `ProviderComposerAdapter` 增加 `detectAttachmentUploadError?()`（先 TODO stub，smoke test 补 selector）。
- [ ] `ProviderComposerAdapter` 增加 `getComposerAttachmentPresence?()`：返回当前 composer 附件 presence（count 或 preview-key 集合）。delivery controller 注入前快照 baseline、注入后比 **delta** 确认新增 [A1 + R2-P1-4]，不只看绝对 count（target 可能已有草稿/旧 preview 会误判）。filename/preview-key 精确匹配作为 per-adapter 可选强化。
- [ ] 附件传输消息：`ATTACHMENT_CREATE`、`ATTACHMENT_APPEND_CHUNK`、`ATTACHMENT_FINALIZE`、`ATTACHMENT_READ_CHUNK`、`ATTACHMENT_ABORT`。

```ts
type UploadCapability = {
  maxFiles: number;
} | null;
```

## 附件存储

- [ ] 新建 `runtime/attachment-store.ts`（background-owned）。
- [ ] `chrome.storage.session` 只存轻量 metadata：ref、owner、createdAt、mime、size、status。
- [ ] IndexedDB 存 raw bytes（`Blob`），key 为 `attachmentId`。
- [ ] 传输用 chunked base64（见「二进制传输契约」），不把 base64 进主协议/metadata/log。
- [ ] **staging owner-binding [P1-b]**：
  - source 在 submit 时还**没有** `workspaceId`（workspace 在 background `handleUserSubmit` 才解析/创建，见 `src/background/delivery.ts:160` 之前有三处早退）。
  - `ATTACHMENT_CREATE` 带 `submitId + name/mime/size` 建 staging 条目；**`ownerTabId` 由 background 从 `sender.tab?.id` 写入，不信任 message payload [R2-P2-6]**（合现有约定，见 `delivery.ts:79`）。
  - background 解析出 workspace 后，内部 `bindAttachments(submitId, workspaceId)` 回填 `ownerWorkspaceId`。
  - release/cleanup 统一以 `submitId` 为 handle（见生命周期），未 bind 的 staging 条目也能被定位清理；TTL 兜底。
- [ ] `ATTACHMENT_ABORT(submitId | ids)` [R2-P2-5]：source 捕获 append/decode 失败、超时、页面卸载时**立即**释放 metadata + partial blob，不等 10min TTL（否则失败的 25MB 上传会把预算卡住 10 分钟）。
- [ ] **`status: 'writing' | 'ready'` [A2]**：`finalize` 后才置 `ready`；`readAttachmentChunks` 对非 `ready` 条目明确失败，不读半截。
- [ ] **budget 在 create 时按声明 size 预留 [A4]**：budget = 所有未释放条目的声明 size 之和；create 时 check+reserve（SW 单线程串行保证原子）。超预算/超单文件/超数量 → create 拒绝，source 跳过 fan-out。
- [ ] 常量：
  - `ATTACHMENT_MAX_AGE_MS = 10 minutes`
  - `ATTACHMENT_SESSION_BUDGET_BYTES = 50 MB`（可调）
  - `ATTACHMENT_MAX_FILE_BYTES = 25 MB`（新增）
  - `ATTACHMENT_MAX_COUNT = 20`
  - `ATTACHMENT_CHUNK_BYTES`（raw，建议 ~256KB）
- [ ] **每次 `ATTACHMENT_CREATE` 的 reserve/check 之前先 sweep expired [R2-P1-1]**：预算入口是 create（不是 USER_SUBMIT）。若只在 USER_SUBMIT 前 sweep，过期附件会先把 create 的 50MB 预算卡死、source 根本发不出 USER_SUBMIT。USER_SUBMIT 前 sweep 可保留但只是次要入口，不是预算闸门。
- [ ] background service worker startup sweep。
- [ ] **不使用 `chrome.alarms` [B3/P1-c]**：manifest 当前只有 `storage`/`tabs`，alarm 是新权限；create-time sweep + startup sweep 已覆盖，去掉 alarm 省权限 + 省代码路径。
- [ ] service worker restart 后不恢复 in-flight delivery，只靠 TTL/startup sweep 清理。
- [ ] `handleClearPersistentStorage` 同时清空 attachment metadata 和 IndexedDB object store。

## 生命周期硬约束（submitId 作用域 [B2]）

- [ ] 每个 attachment metadata 必须含 `createdAt`、`submitId`、`ownerTabId`（**background 从 `sender.tab?.id` 写 [R2-P2-6]**），bind 后含 `ownerWorkspaceId`。
- [ ] **不做 per-delivery `pendingDeliveryIds` 引用计数 [B2]**。理由：一个附件的 bytes 被同一 submit 的所有 target 共享，单个 delivery 完成不能释放；「最后一个 target 完成」≡「该 submit 的 fan-out 完成」≡ submitId 删除——引用计数几乎零收益却是最易泄漏的簿记。
- [ ] **release 挂在 `handleUserSubmit` 的 outer finally，覆盖所有返回路径 [R2-P1-3]**：`handleUserSubmit` 在 fan-out（`deliverPromptToWorkspaceTargets`，`delivery.ts:160`）之前有三处早退——无 workspace（:100）、provider disabled（:119）、**global sync paused（:147）**。若 release 只挂在 fan-out 内层 finally，这三条早退会把已 finalize 的附件泄漏到 TTL。正确做法：`finally { if (message.attachments.length) await store.releaseSubmit(message.submitId) }` 包住整个 `handleUserSubmit`，无论早退/成功/失败/异常都按 `submitId` 删光（metadata + IndexedDB bytes）。
- [ ] v1 不做 same-file dedupe。同一文件 attach 两次存两份，独立按各自 id 删除。
- [ ] TTL 到期必须删除 metadata 和 IndexedDB bytes。
- [ ] IndexedDB orphan blob（无匹配 metadata）在 startup sweep 删除。
- [ ] 删除操作 idempotent：force-delete 与任何延迟清理路径并发时，对已删条目不抛错。
- [ ] 日志优先准确和可诊断：允许 prompt preview / filename key / provider DOM signal；禁止大块二进制 payload、base64 chunk、dataURL。

## Source Capture

- [ ] 在 composer/root 区域监听 `paste`，读取 `clipboardData.files/items`。
- [ ] 在 composer/root 区域监听 `drop`，读取 `dataTransfer.files/items`。
- [ ] document-level capture `input[type=file] change`，再用 provider-specific scoping 判断是否属于当前 composer。
- [ ] **填 per-provider「上传按钮 → 文件落点」矩阵**：哪些 provider 按钮上传落在 ISOLATED 可观察的稳定 input，哪些落在 detached input（需 MAIN-world hook）。
- [ ] MAIN-world transient file-input hook（Manus/Gemini 类）——见 Phase 3.5，从主 capture 拆出。
- [ ] bridge MAIN world 捕获的文件到 isolated content script（候选机制：`window.postMessage` structured-clone `File[]`；执行前由 Phase 2.5 spike 钉死）。
- [ ] 为 clipboard 文件无 filename、`file.type` 为空的情况生成 name/mime。
- [ ] **per-tab in-memory buffer 保存 `File`，capture 时分配稳定 id 并保持到 buffer 清空 [A3]**（不在每次 onSubmit 重新生成 id）。
- [ ] **submit 时：先过 dedupe gate，再写 store [A3]**。store 写入插在 `submit-controller.ts` 的 `rememberSubmitFingerprint`（去重之后）与构建 `USER_SUBMIT`（发送之前）之间。
- [ ] **`USER_SUBMIT` 必须等所有 ref `finalize`（status=ready）后再发 [A2]**。
- [ ] `submit-fingerprint` 加入 attachment ids（capture-time 稳定 id），避免"同文本不同附件"被 dedupe。
- [ ] **submit-time source snapshot 是附件真相源**：capture buffer 只缓存 `File` bytes 来源；发送前一刻读取当前 composer DOM 的 attachment card/preview 来过滤 captured files。无法确认当前附件或无法唯一匹配 → 本次跳过附件 fan-out，不同步旧 buffer。
- [ ] source snapshot 提示：`Attachment sync skipped. Current files could not be confirmed.`
- [ ] 超过 20 个文件 / 单文件 >25MB / 总预算 >50MB 时，跳过附件 fan-out，indicator 提示（`too many files` / `attachment too large`），不阻止源 provider 原生发送。

## Target Delivery

- [ ] 默认 `setComposerPayload`：
  - 开启 suppression guard（覆盖所有程序注入）。
  - 写入文本。
  - 有附件：从 background `ATTACHMENT_READ_CHUNK` 读 base64 chunk，增量重建 `File`。
  - synthetic paste 注入附件（或 provider override 的路径）。
  - **submit 前用 baseline+delta 正向确认 [A1 + R2-P1-4]**：注入前 `getComposerAttachmentPresence()` 快照 baseline，注入后确认 **delta** 等于本次 refs（数量，可选 filename/preview-key 匹配）。delta 不足 → 不发送，映射 `upload-failed`。仅看绝对 count 会把 target 已有的草稿/旧 preview 误判为注入成功；仅靠 send button enable 更不足以证明附件已附上。
  - 附件场景把 send button 等待窗口延长到约 30 秒。
  - 等待期间轮询 `detectAttachmentUploadError()`。
- [ ] Provider override 可替换完整 payload 顺序，不允许 delivery code 硬编码 text-first。
- [ ] suppression 必须覆盖：synthetic paste、stable file input `input/change`、transient input `input/change`，且在注入**之前**开启。
- [ ] **mixed 附件 all-or-nothing [P2-a]**：只对数量/不支持附件这类 ask'em 可确定的能力失败生效；文件类型由 provider 原生上传决定，不在 background 预判。
- [ ] Claude override：稳定 file input fallback。
- [ ] ChatGPT override：synthetic paste。
- [ ] Gemini override：synthetic paste。
- [ ] DeepSeek override：隐藏 file input fallback。
- [ ] Manus override：点击工具按钮，选择 `Add from local files`，捕获 transient input，注入文件。
- [x] explicit upload error 和 timeout 都返回 `upload-failed`，文案统一 `upload failed`。
- [ ] **delivery 释放在 `handleUserSubmit` 的 outer finally 里按 submitId 删除 [B2 + R2-P1-3]**，不在单个 delivery、也不在 fan-out 内层 finally。

## Capability Gate

- [ ] gate 逻辑：只判断 ask'em 自身预算/数量边界，以及 provider 是否支持附件；不判断 MIME/extension/type。
- [ ] 文件类型由目标 provider 原生上传路径决定；provider 拒绝时映射 `upload-failed` 并展示 `upload failed`。
- [ ] count 超 `min(ATTACHMENT_MAX_COUNT, capability.maxFiles)` → `attachment-limit`。
- [ ] capability 为 `null` 的 provider → `unsupported-attachment`，跳过该 provider，不重试，不影响其他 provider。

## UI 和 Issue

- [ ] **`unsupported-attachment` / `attachment-limit` presentation helper 与 Phase 2 capability gate 同批完成**（不拖到 Phase 6），否则 background 已产 issue、UI 解释不了。展示短语如 `attachment not supported` / `attachment limit exceeded`。
- [x] target attachment upload rejection 使用 `upload-failed`，展示 `upload failed`。
- [ ] 不增加新的 uploading phase，继续复用现有 syncing/failure 状态。
- [ ] debug log CSV 测试中 grep，确保没有 base64 或 dataURL。

## 阶段计划

> 改动概览：Phase 0.5 降级为 fixtures（不再是独立执行 phase）；presentation 并入 Phase 2；新增 Phase 2.5 source-capture spike；MAIN-world transient hook 从 Phase 3 拆到 Phase 3.5。

### Phase 0：协议和类型脚手架

- [x] 添加 `AttachmentRef`（无 sha256，不含 file-type policy metadata）、`CapturedAttachment`、`UploadCapability`（count-only policy）。
- [x] 定义附件传输消息类型（`ATTACHMENT_CREATE/APPEND_CHUNK/FINALIZE/READ_CHUNK/ABORT`）。
- [x] 消息协议增加 `attachments: []` 默认值。
- [x] `WorkspaceIssue` 增加 `unsupported-attachment`。
- [x] 所有现有 call site 传空数组。
- [x] 不改行为。

验收：
- [x] `pnpm compile` 通过。
- [x] `pnpm test` 通过。
- [x] 现有 text-only 同步行为不变。

### Phase 0.5（fixtures，非执行 phase）

- [x] 保留 provider 上传策略表为 smoke-test evidence。
- [x] 生成 1×1 PNG fixture（`askem-spike.png`）供后续手测复用。

### Phase 1：Attachment Store 和 GC

- [x] metadata（`chrome.storage.session`）+ raw bytes（IndexedDB `Blob`）。
- [x] **base64 chunk write/read [P1-a]** + `ATTACHMENT_ABORT` [R2-P2-5]，base64 仅限传输消息。
- [x] **staging create + bind owner [P1-b]**；ownerTabId 由 `sender.tab?.id` 写 [R2-P2-6]。
- [x] **status writing/ready + finalize gate [A2]**。
- [x] **budget reserve-on-create + 单文件/数量 check [A4]**；**reserve 前先 sweep expired [R2-P1-1]**。
- [x] **submitId 作用域 release，挂 `handleUserSubmit` outer finally 覆盖早退路径 [B2 + R2-P1-3]**（无引用计数）。
- [x] create-time sweep + startup sweep（**无 alarm [B3]**）。
- [x] orphan blob sweep；delete idempotent。
- [x] persistent storage clear 联动清理附件。

验收：
- [x] base64 chunk write/read 能重建 bytes（roundtrip 测试）。
- [x] bind 后 metadata 含 workspaceId/submitId；未 bind 条目受 TTL 清理。
- [x] 同 submitId 的附件在 fan-out 完成后被删（metadata + blob）。
- [x] **早退路径（无 workspace / disabled / sync paused）也按 submitId 删光 [R2-P1-3]**，有测试。
- [x] **`ATTACHMENT_ABORT` 立即释放 metadata + partial blob [R2-P2-5]**，有测试。
- [x] **过期附件占满预算时，create 前 sweep 能腾出空间让 create 成功 [R2-P1-1]**，有测试。
- [x] expired entry 被 sweep；orphan blob 被 startup sweep。
- [x] reserve-on-create 超预算/超单文件/超数量时 create 抛错，有测试。
- [x] 非 ready 条目的 read 明确失败，有测试。

### Phase 2：Capability Gate + Presentation

- [x] 为 Claude / ChatGPT / Gemini / DeepSeek / Manus 声明 count-only capability。
- [x] background delivery 增加 count/support-only capability gate；文件类型交给 provider 原生上传决定。
- [x] ask'em 不对 mixed file types 做 all-or-nothing 预判；provider 原生拒绝时映射 `upload-failed`。
- [x] target 附件数量超 provider 上限 → `attachment-limit`，跳过该 target，不拆分、不发纯文本。
- [x] 不支持时返回 `unsupported-attachment`，不影响其他 provider。
- [x] **presentation helper 支持 `unsupported-attachment` / `attachment-limit`（同批）**。

验收：
- [x] text-only 行为不变。
- [x] synthetic attachment payload 的 capability gate 测试通过（含任意 file type 放行、count overage、provider 不支持附件）。
- [x] presentation helper 测试覆盖 `unsupported-attachment` / `attachment-limit`。

### Phase 2.5：Source-capture Spike（执行前 spike）

- [x] 验证 `File` 跨 MAIN→ISOLATED world 回传机制（候选：`window.postMessage` structured-clone `File[]`）。
- [x] 验证 Manus/Gemini 类 transient detached input 的捕获可行性。
- [x] 产出：钉死的 bridge 机制说明 + fixture，供 Phase 3/3.5 直接用。

### Phase 3：Source Capture（paste / drop / 稳定 input）

- [x] paste/drop/稳定 file input 捕获 + provider-specific scoping。
- [x] file extraction 不依赖 `instanceof File`；跨 isolated/main world 的 File-like 对象用 duck-typing 接受。
- [x] capture-time 稳定 id 的 per-tab buffer。
- [x] **dedupe gate 先于 store 写入 [A3]**；fingerprint 含 attachment ids。
- [x] buffer → store 的 chunked base64 write；`USER_SUBMIT` 等 finalize 再发 [A2]。
- [x] **过 dedupe 后铸 `submitId`，贯穿 staging create + USER_SUBMIT [R2-P1-2]**；失败/取消时发 `ATTACHMENT_ABORT(submitId)` [R2-P2-5]。
- [x] submit-time source snapshot 过滤 captured files；删除/移除后以发送前一刻 DOM 为准，不再维护删除 shadow state。
- [x] submit-time fallback：若 capture buffer 为空，发送前从 provider-scoped `input[type=file]` 读取当前 `files`，再交给 source snapshot 确认；无当前 preview 时仍 fail-closed，不同步 stale input。
- [x] 超数量/超单文件/超预算跳过 fan-out + 提示，不阻断原生发送。
- [x] submit-runtime suppression 覆盖 synthetic paste / file-input change。

验收：
- [x] Claude 上传一个已支持附件后 submit，`USER_SUBMIT` 有一个 `AttachmentRef`，store 恰好一条。
- [x] text-only 不写 attachment store。
- [x] duplicate-submit dedupe 仍工作（keydown+click 双触发不产生双写）。
- [x] 删除附件后 submit-time snapshot 不再包含该文件，本次不再同步已删除附件。

### Phase 3.5：Manus / Gemini 类 transient input（MAIN-world hook）

- [x] 实现 narrow / idempotent / 可 teardown 的 MAIN-world `input[type=file]` hook。
- [x] 通过 Phase 2.5 钉死的 bridge 把 File 交回 isolated content。

验收：
- [x] Manus detached input 上传一个已支持附件后 submit，`USER_SUBMIT` 有一个 `AttachmentRef`。
- [x] Gemini detached input 上传一个已支持附件后 submit，经同一 transient hook 捕获 raw `File`；submit-time snapshot 仍以 Gemini preview 为准。

### Phase 4：Claude Target Delivery

- [x] 实现 `setComposerPayload` + 从 base64 chunk reconstruct `File`。
- [x] Claude 稳定 file input fallback。
- [x] **submit 前通过 `getComposerAttachmentPresence()` 做 baseline+delta 正向确认 [A1]**。
- [x] 附件 delivery 等待窗口延长 + 轮询 `detectAttachmentUploadError()`（先 TODO stub）。
- [x] `handleUserSubmit` outer finally 按 submitId release [B2 + R2-P1-3]。

验收：
- [x] 一个已支持附件能 fan-out 到 Claude target 并发送。
- [x] **注入失败（mock 不接附件的 DOM）时 target 不发纯文本、上报 `upload-failed` [A1]**。
- [x] `USER_SUBMIT` 发出时对应 ref 已是 `ready` [A2]。
- [x] fan-out 后 store 无残留；人为制造 delivery failure 后 store 仍 drain。

### Phase 5：Per-provider Target Delivery

> 原则：delivery core 只负责读取 refs、重建 `File`、baseline+delta gate、等待/错误映射和 submit 调度；DOM 路径、payload 顺序、presence key、upload error selector 全部留在 provider adapter。

#### Phase 5.0：Delivery rollout 基线

> 5.0 是每家 provider rollout 前/中的 guardrail，不是一次性功能阶段。当前因先有 Claude/ChatGPT 现场页面与日志，5.1 已先落地，并在这里回填已完成的基线项；Gemini/DeepSeek/Manus 仍需各自开工前补齐。

- [x] 固化通用验收 fixture：
  - [x] `askem-spike.png` 单图。
  - [x] `.md/.txt` 纯文本文件。
  - [x] 2 个同批多文件（Claude → ChatGPT 同名 PDF x2 smoke 已通过）。
- [x] 每家 provider 开工前先用 Chrome/extension 实测当前 composer DOM，记录：file injection 入口、attachment preview/chip selector、upload error selector、send button enable 条件。
  - [x] Claude：source snapshot / upload input / PDF preview DOM 已复核（`img[alt]` + `Remove <filename>`，上传后 `input.files` 会清空）。
  - [x] ChatGPT：target composer DOM 已复核（`form[data-type="unified-composer"]` / `#upload-files` / file tile / submit button）。
  - [x] Gemini：target composer DOM 已复核（`.ql-editor[aria-label="Enter a prompt for Gemini"]` / `uploader-file-preview` / `gem-attachment` / `button[aria-label="Send message"]`；长文件名会在 visible chip 截断，完整 filename 在 `aria-describedby` tooltip；当前无稳定 file input）。
  - [x] DeepSeek：target composer DOM 已复核（`textarea[placeholder="Message DeepSeek"]` / composer-scoped hidden `input[type="file"][multiple]` / `.ds-animated-size-item` / `div.ds-icon-button[role="button"][aria-disabled]`）。
  - [x] Manus：target composer DOM 已复核（`.tiptap.ProseMirror` / plus tools button / `role=dialog` 菜单项 `Add from local files` / transient `<input type="file" multiple>` / `[class*="group/attach"]` attachment card / 图片 filename 可能只在 `img[alt]` / `+N` aggregate / `bg-[var(--Button-black)]` send button；free plan 一次选 2 个文件会弹 `You can upload up to 1 file at once` modal；`/app` 会恢复未提交 draft，不保证 clean composer）。
- [x] 每家 provider 的 adapter 测试都覆盖：
  - [x] Claude/ChatGPT 当前链路覆盖注入、presence、baseline+delta、同名重复附件和 source snapshot 过滤。
  - [x] Gemini 注入成功后 `getComposerAttachmentPresence(expected)` 能返回新增 count/key。
  - [x] Gemini target 已有旧草稿附件时，baseline+delta 不误判。
  - [x] Gemini 注入失败或 presence delta 不足时，不点击 send，返回 `upload-failed`（通用 controller gate + adapter presence fixture）。
  - [x] Gemini 多文件一次上传和逐个粘贴/上传后 submit 都能通过确认。
  - [x] DeepSeek 注入成功后 `getComposerAttachmentPresence(expected)` 能返回新增 count/key。
  - [x] DeepSeek target 已有旧草稿附件时，baseline+delta 不误判。
  - [x] DeepSeek 注入失败或 presence delta 不足时，不点击 send，返回 `upload-failed`（通用 controller gate + adapter fail-fast/old-draft fixture）。
  - [x] DeepSeek 多文件一次上传和逐个粘贴/上传后 submit 都能通过确认（adapter fixture 覆盖多文件/同名 preview 计数；真实 smoke 待手测）。
  - [x] Manus 注入成功后 `getComposerAttachmentPresence(expected)` 能返回新增 count/key（visible cards 有 keys；`+N` 聚合时保留 count delta）。
  - [x] Manus target `/app` 恢复未提交 draft 时，经 provider `prepareForDelivery` 点击 `New task` 并确认附件 baseline 为 0 后再注入。
  - [x] Manus 注入失败或 presence delta 不足时，不点击 send，返回 `upload-failed`（通用 controller gate + transient delivery timeout）。
  - [x] Manus free-plan 多文件作为 target 时由 capability gate 拦截为 `attachment-limit`，不进入 transient 注入；adapter 仍能识别 Manus 自身 `up to 1 file` modal 为 `upload failed` 兜底。
- [x] 每家 smoke 后复核 `uploadCapability`：capability 只保留 provider 数量上限；实际文件类型拒绝不收紧 capability，交给 provider 原生上传并映射 `upload-failed`。
- [ ] 保持 debug log 可用于开发排查：不要为隐私牺牲准确性；记录足够定位问题的 prompt preview / filename keys / bytes / count / id prefix。base64/dataURL 仍只应出现在传输层。

#### Phase 5.1：ChatGPT target delivery

- [x] 实测 ChatGPT 当前 composer DOM：`form[data-type="unified-composer"]` / `#prompt-textarea` / `#upload-files` / `role="group"` file tile / `#composer-submit-button`。
- [x] 实现 ChatGPT `setComposerPayload`：
  - [x] 默认 text-first。
  - [x] 优先 composer-scoped `#upload-files` file input 注入；找不到 scoped input 时再 synthetic paste fallback。
  - [x] 注入逻辑在 ChatGPT adapter 内，不改 delivery core。
  - [x] suppression 由 delivery controller 在写文本和注入附件前开启。
- [x] 实现 ChatGPT `getComposerAttachmentPresence(expected)`：
  - [x] count delta。
  - [x] 能取到 filename/preview text 时返回 keys。
  - [x] 同名重复文件无法唯一确认时 fail-closed，避免错配，并 toast 提示本次附件 fan-out 跳过。
- [x] 实现或明确保留 ChatGPT `detectAttachmentUploadError()`：
  - [x] alert / aria-live / toast / error 容器里的 upload failed / unsupported / too large。
  - [ ] 真实 upload rejection smoke 后补更精确 selector（如果当前 selector 漏报则保留 30s timeout 兜底）。
- [x] 测试：
  - [x] adapter DOM fixture 覆盖 file input injection path 和 synthetic paste fallback。
  - [x] presence baseline+delta 测试覆盖已有旧附件。
  - [x] Claude source snapshot 兼容当前 PDF preview DOM（`img[alt]` + `Remove <filename>`），避免 Claude → ChatGPT 时 `captured=1; current=0` 把附件过滤为 0。
  - [ ] delivery-controller 负向测试覆盖 ChatGPT presence 不足不 submit（通用 controller 已覆盖，若发现 ChatGPT 特有条件再补）。
- [x] 手测：
  - [x] Claude/任一 source → ChatGPT target：单图。
  - [x] Claude/任一 source → ChatGPT target：`.md/.txt`。
  - [x] Claude/任一 source → ChatGPT target：多文件（同名 PDF x2）。

#### Phase 5.2：Gemini target delivery

- [x] 实测 Gemini 当前 composer DOM：`.ql-editor`、附件 chip/preview、upload error、send button。
- [x] 实现 Gemini `setComposerPayload`：
  - [x] attach-first：先清空文本并注入附件，等 attachment-only send readiness delta 后再写入 prompt 文本。
  - [x] 优先 synthetic paste 注入附件。
  - [ ] 若 Gemini 只接受 file picker/input，改为 Gemini provider override，不改 delivery core。
  - [x] suppression 覆盖文本写入和附件注入。
- [x] 实现 Gemini `getComposerAttachmentPresence(expected)`：
  - [x] count delta。
  - [x] filename/preview key 可用时返回 keys。
  - [x] 旧草稿附件不参与新增确认。
- [x] Gemini 不依赖固定 delay：preview presence delta 之后必须等无文本状态下 send button 因附件 ready 而可用，再写文本；失败 fail closed。
- [x] 实现或明确保留 Gemini `detectAttachmentUploadError()`：
  - [x] unsupported file / upload failed / retry / toast。
  - [ ] 真实 upload rejection smoke 后补更精确 selector（如果当前 selector 漏报则保留 30s timeout 兜底）。
- [x] 测试：
  - [x] adapter DOM fixture 覆盖 payload injection path。
  - [x] presence baseline+delta 测试覆盖已有旧附件。
  - [x] delivery-controller 负向测试覆盖 Gemini presence 不足不 submit（通用 controller 已覆盖，Gemini adapter fixture 覆盖 count/key）。
  - [x] Gemini adapter 测试覆盖 attachment-only ready 前不写文本、旧草稿同名附件不提前放行，以及 upload error 时 fail closed。
- [x] 手测：
  - [x] Claude/任一 source → Gemini target：单图。
  - [x] Claude/任一 source → Gemini target：`.md/.txt`。
  - [x] Claude/任一 source → Gemini target：多文件。

#### Phase 5.3：DeepSeek target delivery

- [x] 实测 DeepSeek 当前 composer DOM：`textarea[placeholder="Message DeepSeek"]`、隐藏/稳定 file input、附件 chip、upload error、send button。
- [x] 实现 DeepSeek `setComposerPayload`：
  - [x] 默认 text-first。
  - [x] 使用 provider-local hidden/stable file input fallback。
  - [x] 找不到 composer-scoped input 时 fail fast，不尝试全局乱选 input。
  - [x] suppression 覆盖 `input/change`。
- [x] 实现 DeepSeek `getComposerAttachmentPresence(expected)`：
  - [x] count delta。
  - [x] 可用 filename/preview key 时精确匹配。
  - [x] 同名重复文件按 preview card 数量逐个匹配，不复用同一个 DOM card。
- [x] 实现或明确保留 DeepSeek `detectAttachmentUploadError()`：
  - [x] upload failed / unsupported / toast / retry。
  - [x] 无稳定 selector 时保留 30s timeout 兜底。
- [x] 测试：
  - [x] adapter DOM fixture 覆盖 hidden input 注入。
  - [x] presence baseline+delta 测试覆盖已有旧附件。
  - [x] delivery-controller 负向测试覆盖 DeepSeek presence 不足不 submit（通用 controller gate 已覆盖，DeepSeek adapter fixture 提供 count/key 负样本）。
- [x] 手测：
  - [x] Claude/任一 source → DeepSeek target：单图。
  - [x] Claude/任一 source → DeepSeek target：`.md/.txt`。
  - [x] Claude/任一 source → DeepSeek target：多文件。

#### Phase 5.4：Manus target delivery

- [x] 实测 Manus 当前 composer DOM：`.tiptap.ProseMirror`、工具按钮、`Add from local files` 菜单项、transient input、附件 chip、upload error、send button。
- [x] 实现 Manus `setComposerPayload`：
  - [x] 明确 payload 顺序：text-first；附件通过 Manus adapter override 注入，不改 delivery core。
  - [x] capability 收紧为 `maxFiles=1`；多文件 fan-out 到 Manus target 时跳过该 target，不触发 Manus 升级 modal。
  - [x] 实现 Manus `prepareForDelivery`：new-chat target 先进入 clean `New task` surface；已有 session 若 composer 非 clean 则失败，不跳离原 session。
  - [x] 点击 composer-scoped 工具按钮。
  - [x] 选择 `Add from local files`。
  - [x] 复用 Phase 3.5 MAIN-world transient input bridge，把文件注入 transient input。
  - [x] 任一步找不到目标时 fail fast；pending transient delivery 有 timeout 清理。
  - [x] suppression 覆盖 menu-triggered transient input 的 `input/change`。
- [x] 实现 Manus `getComposerAttachmentPresence(expected)`：
  - [x] count delta。
  - [x] 可用 filename/preview key 时精确匹配。
  - [x] `+N` 聚合隐藏 filenames 时只返回 count，不返回不完整 keys，避免 key 误导。
- [x] 实现或明确保留 Manus `detectAttachmentUploadError()`：
  - [x] upload failed / unsupported / retry / toast。
  - [x] free-plan 多文件 modal（`You can upload up to 1 file at once`）识别为 `upload failed`。
  - [x] 无稳定 selector 时保留 30s timeout 兜底。
- [x] 测试：
  - [x] adapter DOM fixture 覆盖菜单触发路径。
  - [x] transient hook teardown 测试覆盖成功、失败、timeout。
  - [x] presence baseline+delta 测试覆盖已有旧附件。
  - [x] delivery-controller 负向测试覆盖 Manus presence 不足不 submit（通用 controller gate 已覆盖，Manus adapter fixture 提供 count/key 负样本）。
- [x] 手测：
  - [x] Claude/任一 source → Manus target：单图。
  - [x] Claude/任一 source → Manus target：`.md/.txt`。
  - [x] Claude/任一 source → Manus target：多文件应跳过 Manus target 并展示 `attachment limit exceeded` / toast，其他 provider 不受影响。

#### Phase 5.5：Provider delivery 收口

- [x] 5 个 provider（含 Claude）作为 target 都能收到 fanned-out 已支持附件。
- [x] 任一 provider 不支持某格式/数量时，只标记该 provider，不影响其他 provider。
- [x] 任一 provider attachment injection 静默失败时，不发送纯文本，标记 `upload-failed`。
- [x] 每家 target 的日志序列可用于排查：delivery started → payload injected → attachment presence confirmed → submit dispatched / delivery failed。
- [x] `pnpm compile`、`pnpm test`、`pnpm build` 通过。

### Phase 6：UI Surfacing

- [x] indicator/popup 展示 `attachment not supported` / `attachment limit exceeded`（presentation helper 已在 Phase 2 就绪，这里接线）。
- [x] target 上传失败展示 `upload failed`。
- [x] 不增加新 uploading 状态。
- [x] debug logs 不含大块二进制 payload / base64 chunk / dataURL；prompt preview 和 filename key 允许用于开发排查。

验收：
- [x] 不支持附件时 popup 能看到 `attachment not supported`；超 target 数量上限时能看到 `attachment limit exceeded`。
- [x] target 上传失败时能看到 `upload failed`。
- [x] log grep 无 base64/dataURL。

### Phase 7：Hardening

- [x] 测试 background restart mid-delivery，TTL 能清理 orphan。
- [x] 权限审计：确认不需要新增 `host_permissions`，且**确认未引入 `alarms`**。
- [x] 扩展现有 `chrome.tabs.onRemoved` handler：source tab 关闭时只清该 `ownerTabId` 下 `status=writing` 且未 bind 的 staging 条目，提前腾预算；不清 ready 条目，避免 USER_SUBMIT→bind 窗口内误删 fan-out 附件。
- [x] 补充 lifecycle/pitfall 文档（含「logs must stay diagnostic」「never assume source upload finished before capture」「base64 仅限传输消息」）。

验收：
- [x] restart/orphan dry-run 后 store 为空。
- [x] 所有测试通过。

## Guardrails

- [x] debug log 优先准确和可诊断；不记录大块二进制 payload、base64 chunk、dataURL。
- [x] **base64 只出现在 `ATTACHMENT_APPEND_CHUNK`/`ATTACHMENT_READ_CHUNK`**；不进主协议、storage metadata、log。
- [x] 不在主 runtime message 内塞 inline 二进制。
- [x] 不写入没有 TTL 的附件。
- [x] 不写入没有 release 路径的附件（release = `handleUserSubmit` outer finally 按 submitId 删除，覆盖**所有**早退/成功/失败路径 [R2-P1-3] + ABORT 即时释放 + TTL 兜底）。
- [x] 不静默把附件 submit 成纯文本：target submit 前必须通过 `getComposerAttachmentPresence()` 做 baseline+delta 确认 [A1]。
- [x] 不阻止源 provider 原生发送。
- [x] 不引入 `chrome.alarms` 或其他新权限。

## Deferred Architecture Cleanup（当前 TODO 全部完成后再评估）

- [x] 抽公共 file input helper：复用 `accept` 解析、extension/MIME 匹配、`multiple` 选择等纯函数；provider-specific root/selector 继续留在各 adapter。
- [x] 封装 `ComposerAttachmentPresence` delta/key 语义：集中 `count + keys` 的 baseline/delta 计算、duplicate filename/聚合卡片约束和测试，避免 adapter 误用 keys。



---


- 总体原则是把复杂度都留给 provider-specific 的逻辑，插件核心逻辑保持尽可能干净鲁棒

- 支持的文件采用黑名单策略
- 防止用户在源页面添加又删除附件，保留 capture buffer 作为 bytes cache，但不在系统内维护shadow state，而是在源页面发送前一刻通过DOM 决定最终附件集合。
- 上传同名附件、上传又删除、上传同名附件又删除




- 手动新建 set。可以输入 urls，但不复用 tab 而是新开，来收集 tabid
- 首次 fanout 后不再默认开启同步/第一条之后，默认关闭同步
- 为什么 chatgpt ready 这么慢，实际已经可以 fan out
- default on/off 应该跟随用户设置落存储
- Default auto-sync new chats，default to 御三家

- 消息的格式化要保留
- ext & 落地页要接 posthog，要获取 什么 work 什么不 work 的信息
- ~~统一 input。可以统一输入 prompt，也可以分开不同 provider 输入不同 prompt 方便首次 fanout 之后的输入~~
- 隐身模式发起