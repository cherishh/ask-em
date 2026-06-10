# Plan: Structured Workspace Issue Metadata

## Goal

Replace flat workspace issue strings with structured issue metadata so delivery, presence, attachment, and auth failures can be classified, recovered, displayed, and debugged without losing important context.

The immediate bug class is: a provider accepts a delivered prompt, but session confirmation times out. Later provider presence proves the delivery succeeded. With the current string-only `delivery-failed` state, the app cannot distinguish that recoverable timeout from a real failed delivery.

## Current State

Workspace issues are stored as:

```ts
memberIssues?: Partial<Record<Provider, WorkspaceIssue>>;
```

`WorkspaceIssue` is a string union:

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

This is simple, but it collapses separate facts into one value:

- Whether the provider accepted the prompt.
- Whether the provider confirmed the session.
- Whether the issue came from presence, delivery, attachment upload, or capability checks.
- Whether the issue should clear automatically on `ready`, on a new session id, on a future successful delivery, or only by user action.
- Which submit attempt created the issue.
- Which URL/session was expected.
- Which reason was logged.

## Target Model

Introduce a structured issue record while keeping legacy strings readable during migration.

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

During rollout, storage should tolerate both legacy string values and v2 records:

```ts
memberIssues?: Partial<Record<Provider, WorkspaceIssueValue>>;
```

After migration is proven stable, legacy strings can be removed from storage writes, but read compatibility should remain for at least one release.

## Recovery Semantics

Centralize recovery decisions in one module instead of spreading conditionals across presence and delivery code.

Proposed helper:

```ts
shouldClearIssueOnPresence(issue, observation): boolean
```

Rules:

- Presence issue with `recoveryMode: 'clear-on-ready'` clears when page state becomes `ready`.
- `needs-login` clears when page state becomes `ready`.
- Recoverable unconfirmed delivery clears when:
  - issue type is `delivery-failed`,
  - issue source is `delivery`,
  - `accepted === true`,
  - `confirmed === false`,
  - `recoveryMode === 'clear-on-new-session'`,
  - current presence has a non-null `sessionId`,
  - current `sessionId` differs from `previousSessionId` or matches an expected post-delivery session when available.
- Upload and attachment capability issues do not clear from passive `ready` presence.
- A later successful delivery to the same provider clears old delivery/upload issues for that provider.
- Manual issues clear only through explicit workspace/provider removal or user action.

## Implementation Phases

### Phase 1: Add issue metadata helpers

Create `src/runtime/workspace-issues.ts`.

Responsibilities:

- Define v2 issue types.
- Normalize legacy string issues to v2 records for read paths.
- Convert v2 records to compact labels for UI.
- Classify delivery results into issue records.
- Classify page state into presence issue records.
- Decide whether an issue counts as "needs attention".
- Decide whether presence or successful delivery clears an issue.

Key functions:

```ts
normalizeWorkspaceIssue(value, now): WorkspaceIssueRecord | null
getWorkspaceIssueType(value): WorkspaceIssueType | null
isWorkspaceIssueWarning(value): boolean
createPresenceIssue(pageState, now): WorkspaceIssueRecord | null
createDeliveryIssue(result, context): WorkspaceIssueRecord | null
shouldClearIssueOnPresence(issue, observation): boolean
shouldClearIssueOnDeliverySuccess(issue): boolean
```

### Phase 2: Update storage and workspace helpers

Files:

- `src/runtime/types.ts`
- `src/runtime/workspace.ts`
- `src/runtime/workspace.test.ts`

Changes:

- Update `Workspace.memberIssues` type to accept `WorkspaceIssueValue`.
- Update `setWorkspaceProviderIssue` to accept either a legacy type or a v2 record.
- Update `clearWorkspaceProviderIssue` without behavior changes.
- Keep `WorkspaceSummary.memberIssues` backward compatible at first, or introduce `memberIssueRecords` alongside it for a staged UI migration.

Recommended staged summary shape:

```ts
type WorkspaceSummary = {
  workspace: Workspace;
  memberStates: Partial<Record<Provider, GroupMemberState>>;
  memberIssues: Partial<Record<Provider, WorkspaceIssueType | null>>;
  memberIssueRecords: Partial<Record<Provider, WorkspaceIssueRecord | null>>;
};
```

This lets old UI logic keep working while new UI logic moves to metadata.

### Phase 3: Update issue writers

Files:

- `src/background/presence-issues.ts`
- `src/background/presence-persistence.ts`
- `src/background/delivery-issues.ts`
- `src/background/delivery.ts`
- `src/background/delivery-executor.ts`

Presence:

- Replace string creation in `getWorkspaceIssueForPageState` with `createPresenceIssue`.
- Use `shouldClearIssueOnPresence` to clear existing records.
- Log clear events when a structured recoverable issue is resolved.

Delivery:

- Extend `ProviderDeliveryResult` or pass extra delivery context into issue classification:
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
- For `accepted: true, confirmed: false`, write a recoverable v2 `delivery-failed` issue with `recoveryMode: 'clear-on-new-session'`.
- For true injection failures, write non-recoverable or success-delivery-recoverable metadata depending on failure type.
- For upload failures, write `source: 'attachment'`, `recoveryMode: 'clear-on-successful-delivery'` or `manual`.
- For attachment capability failures, write `source: 'capability'`, `recoveryMode: 'manual'`.

### Phase 4: Update readers and UI

Files:

- `src/background/status.ts`
- `src/content/indicator.ts`
- `src/content/ui-render.ts`
- `src/content/view-runtime.ts`
- `src/entrypoints/popup/*` if popup renders workspace issues directly

Changes:

- `buildWorkspaceSummary` should normalize both legacy and v2 issues.
- Indicator issue count should use `isWorkspaceIssueWarning`.
- Indicator labels can remain count-based first, then become more specific later.
- Workspace panel can show issue details from metadata:
  - "Delivery accepted, waiting for ChatGPT session confirmation"
  - "Upload failed"
  - "Login required"
  - "Attachment count not supported"

Avoid adding too much visible text in the first migration. The first goal is correctness and debuggability.

### Phase 5: Add migration and compatibility tests

No eager destructive migration is required. Prefer lazy normalization on read, with all new writes using v2 records.

Tests:

- Legacy string `delivery-failed` still counts as warning.
- Legacy string `loading` clears on ready.
- V2 presence `loading` clears on ready.
- V2 upload failure does not clear on ready.
- V2 accepted/unconfirmed delivery clears on new session.
- V2 accepted/unconfirmed delivery does not clear when ready has no session.
- V2 accepted/unconfirmed delivery does not clear when already-bound session is unchanged.
- Successful delivery clears previous delivery issue for the same provider.
- `buildWorkspaceSummary` returns both legacy issue type and v2 record.
- Indicator count is unchanged for legacy and v2 issues.
- Debug logs include issue source and recovery mode for recovered issues.

### Phase 6: Clean up old ad hoc logic

After all write paths produce v2 records:

- Remove issue-specific string conditionals from `presence-issues.ts`.
- Move delivery reason parsing into `workspace-issues.ts`.
- Keep legacy read compatibility.
- Update docs in `docs/architecture/state-ownership.md` or add a short workspace issue architecture note.

## Acceptance Criteria

- All existing tests pass.
- New tests cover legacy string issues and v2 records.
- A provider that accepted a new-chat delivery but timed out waiting for session ref no longer leaves a permanent false `delivery-failed` once a new session is observed.
- Upload failures and unsupported attachment issues are not cleared merely because the page becomes ready.
- Indicator behavior remains stable for existing issue types.
- Debug logs make it clear whether an issue was created by presence, delivery, attachment upload, or capability checks.
- Stored state from old extension versions remains readable.

## Risks

- Changing storage shape can break old assumptions in popup/content code.
- Over-eager recovery can hide true failed deliveries.
- Keeping both legacy and v2 issue shapes temporarily increases type complexity.
- More detailed issue metadata may expose noisy internal messages in UI if not carefully mapped.

Mitigation:

- Normalize through one helper module.
- Keep UI labels conservative.
- Write focused tests around recovery boundaries.
- Avoid eager migration until v2 read/write paths are stable.

## Recommended Commit Sequence

1. Add `workspace-issues.ts` with types, normalization, and tests.
2. Update runtime types and workspace helpers to accept v2 records.
3. Update presence issue write and recovery paths.
4. Update delivery issue classification to write v2 records.
5. Update summary, indicator, and panel readers to use normalized metadata.
6. Add migration compatibility tests and remove duplicated string parsing.

## Open Questions

- Should `WorkspaceSummary` expose both `memberIssues` and `memberIssueRecords`, or should all consumers migrate in one commit?
- Should `submitId` be stored in local state long term, or should it be reduced to a short diagnostic id?
- Should recoverable unconfirmed delivery be shown as warning immediately, or as a lower-severity pending confirmation state?
- Should old non-recoverable `delivery-failed` strings be treated as manual recovery only, or normalized as recoverable when the member had no previous session?
