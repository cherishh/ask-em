# 方案 3 计划：结构化 Workspace Issue Metadata

## 目标

把现在的扁平字符串 issue 改成结构化 metadata，让 delivery、presence、attachment、auth 这些来源不同的异常可以被准确分类、恢复、展示和诊断。

这次 bug 的本质是：目标 provider 已经接受了 prompt 投递，但等待 session 确认超时；后续 provider presence 又证明投递其实成功了。当前只有一个字符串 `delivery-failed`，无法区分“可恢复的确认超时”和“真实投递失败”，所以 indicator 会产生假阳性。

## 当前状态

Workspace issue 现在存成：

```ts
memberIssues?: Partial<Record<Provider, WorkspaceIssue>>;
```

`WorkspaceIssue` 是字符串 union：

```ts
type WorkspaceIssue =
  | 'needs-login'
  | 'loading'
  | 'delivery-failed'
  | 'upload-failed'
  | 'error-page'
  | 'private-mode'
  | 'attachment-limit'
  | 'unsupported-attachment';
```

这个模型很简单，但它把很多关键事实压扁了：

- provider 是否已经接受 prompt。
- provider 是否已经确认 session。
- issue 来自 presence、delivery、attachment upload 还是 capability check。
- issue 应该在 `ready` 时自动清理，还是在新 session 出现时清理，还是等下一次成功投递，还是只能手动清理。
- 哪一次 submit attempt 创建了 issue。
- 当时期待的 URL/session 是什么。
- 原始失败 reason 是什么。

## 目标模型

新增结构化 issue record，同时在迁移期继续兼容旧字符串。

```ts
export type WorkspaceIssueType =
  | 'needs-login'
  | 'loading'
  | 'delivery-failed'
  | 'upload-failed'
  | 'error-page'
  | 'private-mode'
  | 'attachment-limit'
  | 'unsupported-attachment';

export type WorkspaceIssueSource =
  | 'presence'
  | 'delivery'
  | 'attachment'
  | 'capability';

export type WorkspaceIssueSeverity = 'warning' | 'error';

export type WorkspaceIssueRecoveryMode =
  | 'clear-on-ready'
  | 'clear-on-new-session'
  | 'clear-on-successful-delivery'
  | 'manual';

export type WorkspaceIssueRecord = {
  version: 2;
  type: WorkspaceIssueType;
  source: WorkspaceIssueSource;
  severity: WorkspaceIssueSeverity;
  recoverable: boolean;
  recoveryMode: WorkspaceIssueRecoveryMode;
  createdAt: number;
  updatedAt: number;
  message?: string;
  reason?: string;
  submitId?: string;
  accepted?: boolean;
  confirmed?: boolean;
  blocked?: boolean;
  expectedSessionId?: string | null;
  previousSessionId?: string | null;
  observedSessionId?: string | null;
  expectedUrl?: string;
  observedUrl?: string;
};

export type WorkspaceIssueValue = WorkspaceIssueType | WorkspaceIssueRecord;
```

迁移期 storage 允许两种形态共存：

```ts
memberIssues?: Partial<Record<Provider, WorkspaceIssueValue>>;
```

稳定后，新写入都应该写 v2 record；读取路径继续兼容旧字符串至少一个版本，避免用户升级时丢状态或报错。

## 恢复语义

把 issue 的恢复判断集中到一个模块，避免 presence、delivery、indicator 各自维护一套条件。

建议核心 helper：

```ts
shouldClearIssueOnPresence(issue, observation): boolean
```

规则：

- `source: 'presence'` 且 `recoveryMode: 'clear-on-ready'` 的 issue，在页面变成 `ready` 时清理。
- `needs-login` 在页面变成 `ready` 时清理。
- 可恢复的 unconfirmed delivery 在以下条件全部满足时清理：
  - `type === 'delivery-failed'`
  - `source === 'delivery'`
  - `accepted === true`
  - `confirmed === false`
  - `recoveryMode === 'clear-on-new-session'`
  - 当前 presence 有非空 `sessionId`
  - 当前 `sessionId` 不等于 `previousSessionId`，或者能匹配预期的 post-delivery session
- `upload-failed`、`attachment-limit`、`unsupported-attachment` 不因为页面 passive `ready` 就清理。
- 同一个 provider 后续成功投递时，可以清理旧的 delivery/upload issue。
- `manual` recovery 的 issue 只通过用户显式操作或 workspace/provider 清理移除。

## 实施阶段

### Phase 1：新增 issue metadata helper

新增文件：

- `src/runtime/workspace-issues.ts`

职责：

- 定义 v2 issue 类型。
- 把旧字符串 normalize 成 v2 record，供读取路径统一消费。
- 把 v2 record 映射成 UI 需要的紧凑 label。
- 把 delivery result 分类成 issue record。
- 把 page state 分类成 presence issue record。
- 判断某个 issue 是否应该算作 needs attention。
- 判断 presence 或成功 delivery 是否应该清理某个 issue。

建议函数：

```ts
normalizeWorkspaceIssue(value, now): WorkspaceIssueRecord | null
getWorkspaceIssueType(value): WorkspaceIssueType | null
isWorkspaceIssueWarning(value): boolean
createPresenceIssue(pageState, now): WorkspaceIssueRecord | null
createDeliveryIssue(result, context): WorkspaceIssueRecord | null
shouldClearIssueOnPresence(issue, observation): boolean
shouldClearIssueOnDeliverySuccess(issue): boolean
```

### Phase 2：更新 storage 和 workspace helper

涉及文件：

- `src/runtime/types.ts`
- `src/runtime/workspace.ts`
- `src/runtime/workspace.test.ts`

改动：

- 把 `Workspace.memberIssues` 类型改成支持 `WorkspaceIssueValue`。
- 让 `setWorkspaceProviderIssue` 接受旧字符串或 v2 record。
- `clearWorkspaceProviderIssue` 行为保持不变。
- `WorkspaceSummary` 先保持向后兼容，推荐新增 `memberIssueRecords`，让 UI 可以分阶段迁移。

建议 summary 形态：

```ts
type WorkspaceSummary = {
  workspace: Workspace;
  memberStates: Partial<Record<Provider, GroupMemberState>>;
  memberIssues: Partial<Record<Provider, WorkspaceIssueType | null>>;
  memberIssueRecords: Partial<Record<Provider, WorkspaceIssueRecord | null>>;
};
```

这样旧的 indicator 逻辑还能继续读 `memberIssues`，新的诊断和 UI 可以读 `memberIssueRecords`。

### Phase 3：更新 issue 写入路径

涉及文件：

- `src/background/presence-issues.ts`
- `src/background/presence-persistence.ts`
- `src/background/delivery-issues.ts`
- `src/background/delivery.ts`
- `src/background/delivery-executor.ts`

Presence 侧：

- 用 `createPresenceIssue` 替代现在的字符串创建。
- 用 `shouldClearIssueOnPresence` 判断是否清理已有 issue。
- 当结构化 recoverable issue 被 presence 恢复时，写明确 debug log。

Delivery 侧：

- 扩展 `ProviderDeliveryResult`，或者把额外 delivery context 传给 issue classifier：
  - `submitId`
  - source provider
  - target provider
  - expected session id
  - expected URL
  - previous member session id
  - accepted
  - confirmed
  - blocked
  - reason
- 对 `accepted: true, confirmed: false` 写入可恢复的 v2 `delivery-failed`：
  - `source: 'delivery'`
  - `recoverable: true`
  - `recoveryMode: 'clear-on-new-session'`
- 对真实注入失败，根据原因写成 non-recoverable 或 `clear-on-successful-delivery`。
- 对 upload 失败写：
  - `source: 'attachment'`
  - `recoveryMode: 'clear-on-successful-delivery'` 或 `manual`
- 对 attachment capability 失败写：
  - `source: 'capability'`
  - `recoveryMode: 'manual'`

### Phase 4：更新读取路径和 UI

涉及文件：

- `src/background/status.ts`
- `src/content/indicator.ts`
- `src/content/ui-render.ts`
- `src/content/view-runtime.ts`
- `src/entrypoints/popup/*`

改动：

- `buildWorkspaceSummary` normalize 旧字符串和 v2 issue。
- indicator 计数改用 `isWorkspaceIssueWarning`。
- 第一阶段 indicator 文案可以继续保持 count-based，避免 UI 一次改太多。
- workspace panel 可以逐步展示结构化详情：
  - “Delivery accepted, waiting for ChatGPT session confirmation”
  - “Upload failed”
  - “Login required”
  - “Attachment count not supported”

第一阶段不要加太多新可见文案。目标先是状态正确和诊断清楚。

### Phase 5：增加迁移和兼容性测试

不建议做 eager destructive migration。优先做 lazy normalization：读取时兼容旧值，新写入统一写 v2 record。

测试矩阵：

- 旧字符串 `delivery-failed` 仍然算 warning。
- 旧字符串 `loading` 在 ready 时清理。
- v2 presence `loading` 在 ready 时清理。
- v2 `upload-failed` 不因为 ready 清理。
- v2 accepted/unconfirmed delivery 在新 session 出现时清理。
- v2 accepted/unconfirmed delivery 在 ready 但没有 session 时不清理。
- v2 accepted/unconfirmed delivery 在已有 session 未变化时不清理。
- 同 provider 后续成功 delivery 会清理旧 delivery issue。
- `buildWorkspaceSummary` 同时返回 legacy issue type 和 v2 record。
- legacy issue 和 v2 issue 对 indicator count 的结果一致。
- recoverable issue 被清理时，debug log 包含 source 和 recovery mode。

### Phase 6：清理旧的 ad hoc 逻辑

当所有写入路径都写 v2 record 后：

- 删除 `presence-issues.ts` 里零散的字符串条件判断。
- 把 delivery reason parsing 集中到 `workspace-issues.ts`。
- 继续保留 legacy read compatibility。
- 在 `docs/architecture/state-ownership.md` 或新文档里补一段 workspace issue 架构说明。

## 验收标准

- 所有现有测试通过。
- 新测试覆盖旧字符串和 v2 record。
- provider 已接受 new-chat delivery 但 session ref timeout 后，如果之后观察到新 session，不再留下永久 false `delivery-failed`。
- upload failure 和 unsupported attachment issue 不会仅因为页面变 ready 就被清理。
- indicator 对现有 issue 类型的行为保持稳定。
- debug log 能看出 issue 是由 presence、delivery、attachment upload 还是 capability check 创建。
- 老版本 extension 写入的 storage 状态仍然可读。

## 风险

- storage shape 变化可能打破 popup/content 里的旧假设。
- 恢复规则过宽会隐藏真实投递失败。
- 迁移期同时支持旧字符串和 v2 record，会增加类型复杂度。
- issue metadata 里的内部 reason 如果直接展示到 UI，可能会显得噪声很大。

缓解方式：

- 所有读写都通过 `workspace-issues.ts` normalize。
- UI 文案第一阶段保持保守，不直接展示原始 reason。
- 对恢复边界写聚焦测试。
- v2 读写稳定前不做 eager migration。

## 推荐提交顺序

1. 新增 `workspace-issues.ts`，包含类型、normalize、分类和测试。
2. 更新 runtime types 和 workspace helper，让 storage 接受 v2 record。
3. 更新 presence issue 写入和恢复路径。
4. 更新 delivery issue classification，让 delivery 写 v2 record。
5. 更新 summary、indicator、workspace panel 读取逻辑。
6. 增加迁移兼容测试，删除重复字符串解析。

## 待确认问题

- `WorkspaceSummary` 是同时暴露 `memberIssues` 和 `memberIssueRecords`，还是一次性迁移所有 consumer？
- `submitId` 是否应该长期存入 local state，还是只存短 diagnostic id？
- recoverable unconfirmed delivery 是否应该立刻显示 warning，还是显示低一级的 pending confirmation 状态？
- 老的非结构化 `delivery-failed` 字符串应该按 manual recovery 处理，还是在 member 之前没有 session 时推断为 recoverable？
