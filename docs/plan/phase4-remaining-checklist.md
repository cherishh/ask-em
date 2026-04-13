# Phase 4 Remaining Checklist

This checklist narrows the remaining `Phase 4` work into concrete slices.

The goal is not to redesign the extension. The goal is to finish the cleanup of the highest-branching orchestration and local runtime state paths.

## Remaining Theme

The biggest remaining `Phase 4` issues are:

- `background/presence.ts` still owns too many responsibilities in one file
- `content/state.ts` still acts as a local mutable state hub
- richer recovery semantics are only partly reflected in issue classification

## Checklist

### 1. Split `background/presence.ts`

Status: `done`

Target outcomes:

- detach logic is separated from presence response building
- workspace lookup / transfer logic is separated from issue persistence
- the top-level handler reads more like orchestration than a decision tree

Suggested slices:

- extract detach and transfer helpers into a `presence-reconciliation.ts`
- extract page-state-to-workspace-issue mapping into a small helper
- extract presence response building into a dedicated helper

Relevant files:

- [src/background/presence.ts](/Users/zhongxi/code/other/ask-em/src/background/presence.ts)
- [src/background/presence-reconciliation.ts](/Users/zhongxi/code/other/ask-em/src/background/presence-reconciliation.ts)
- [src/background/presence-issues.ts](/Users/zhongxi/code/other/ask-em/src/background/presence-issues.ts)
- [src/background/presence-response.ts](/Users/zhongxi/code/other/ask-em/src/background/presence-response.ts)
- [src/background/presence-persistence.ts](/Users/zhongxi/code/other/ask-em/src/background/presence-persistence.ts)

### 2. Finish `content/state.ts` cleanup

Status: `done`

Target outcomes:

- fewer raw mutable locals in the main closure
- local state transitions become easier to test independently
- UI writes stay clearly separated from transition logic

Suggested slices:

- extract `standaloneCreateSetTouched` handling into a tiny transition helper
- extract submit suppression window helpers
- consider grouping the remaining mutable state into 2-3 named local state records instead of many unrelated scalars

Relevant files:

- [src/content/state.ts](/Users/zhongxi/code/other/ask-em/src/content/state.ts)
- [src/content/context.ts](/Users/zhongxi/code/other/ask-em/src/content/context.ts)
- [src/content/submit-memory.ts](/Users/zhongxi/code/other/ask-em/src/content/submit-memory.ts)
- [src/content/submit-fingerprint.ts](/Users/zhongxi/code/other/ask-em/src/content/submit-fingerprint.ts)
- [src/content/sync-progress.ts](/Users/zhongxi/code/other/ask-em/src/content/sync-progress.ts)
- [src/content/view-runtime.ts](/Users/zhongxi/code/other/ask-em/src/content/view-runtime.ts)
- [src/content/submit-runtime.ts](/Users/zhongxi/code/other/ask-em/src/content/submit-runtime.ts)

### 3. Make recovery semantics more explicit

Status: `done`

Target outcomes:

- `ready`, `login-required`, `error`, and `not-ready` have more consistent meaning across recovery and issue persistence
- fewer generic `not ready` fallbacks hide more specific state

Suggested slices:

- review [src/background/delivery-targets.ts](/Users/zhongxi/code/other/ask-em/src/background/delivery-targets.ts) and [src/background/delivery-issues.ts](/Users/zhongxi/code/other/ask-em/src/background/delivery-issues.ts) together
- decide whether `error-page` should be classified more directly during delivery failures
- document which states are treated as terminal vs retryable

Implemented notes and helpers:

- [src/background/recovery-semantics.ts](/Users/zhongxi/code/other/ask-em/src/background/recovery-semantics.ts)
- [docs/architecture/recovery-semantics.md](/Users/zhongxi/code/other/ask-em/docs/architecture/recovery-semantics.md)

### 4. Write down soft-detach vs hard-failure rules

Status: `done`

Target outcomes:

- normal tab movement is not over-exposed as user-facing failure
- true recovery failures are easier to classify and explain

Suggested slices:

- define the internal distinction in a small design note
- keep current product copy if desired, but document the underlying semantics

Relevant files:

- [src/background/presence.ts](/Users/zhongxi/code/other/ask-em/src/background/presence.ts)
- [src/background/delivery.ts](/Users/zhongxi/code/other/ask-em/src/background/delivery.ts)
- [src/background/delivery-issues.ts](/Users/zhongxi/code/other/ask-em/src/background/delivery-issues.ts)
- [docs/architecture/soft-detach-hard-failure.md](/Users/zhongxi/code/other/ask-em/docs/architecture/soft-detach-hard-failure.md)

## Suggested Execution Order

1. Split `presence.ts`
2. Finish `content/state.ts` cleanup
3. Tighten recovery semantics
4. Document soft-detach vs hard-failure

This order keeps the refactors incremental and avoids mixing behavior changes with structure-only cleanup too early.
