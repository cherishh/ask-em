last modified: 2026-04-13 23:32:08 +08

# State Ownership

This document defines where state truth lives in ask'em and where it should not live.

It exists to keep future changes from reintroducing the same ambiguity that the codebase audit addressed.

## Core Rule

Business state has one source of truth:

- `background/` owns extension coordination state
- `runtime/` owns shared contracts and pure domain transforms
- `content/` owns page-local UI/runtime state
- `popup/` owns popup-local UI state only

Do not create a second source of truth for workspace state in popup or content code.

## Background

`background/` is the coordination center.

It owns:

- workspace creation and membership
- claimed tab ownership
- delivery target resolution
- provider issue persistence
- sync fan-out decisions

Relevant modules:

- [src/background/delivery.ts](/Users/zhongxi/code/other/ask-em/src/background/delivery.ts)
- [src/background/presence.ts](/Users/zhongxi/code/other/ask-em/src/background/presence.ts)
- [src/background/status.ts](/Users/zhongxi/code/other/ask-em/src/background/status.ts)
- [src/background/settings.ts](/Users/zhongxi/code/other/ask-em/src/background/settings.ts)

## Runtime

`runtime/` is for shared contracts and pure state transforms.

It should contain:

- shared message and type definitions
- domain-style helpers that do not depend on Chrome APIs
- storage schema and protocol contracts

It should not contain:

- tab orchestration
- `chrome.tabs` interaction
- content readiness polling

Relevant modules:

- [src/runtime/protocol.ts](/Users/zhongxi/code/other/ask-em/src/runtime/protocol.ts)
- [src/runtime/workspace.ts](/Users/zhongxi/code/other/ask-em/src/runtime/workspace.ts)
- [src/runtime/storage.ts](/Users/zhongxi/code/other/ask-em/src/runtime/storage.ts)

## Content

`content/` owns page-local runtime and indicator UI state.

It may keep transient state such as:

- current indicator placement
- current synced workspace context snapshot
- in-flight sync progress
- local submit suppression and dedupe state

It must not become the source of truth for:

- workspace membership
- persistent provider issues
- cross-tab coordination

Relevant modules:

- [src/content/state.ts](/Users/zhongxi/code/other/ask-em/src/content/state.ts)
- [src/content/context.ts](/Users/zhongxi/code/other/ask-em/src/content/context.ts)
- [src/content/ui.ts](/Users/zhongxi/code/other/ask-em/src/content/ui.ts)

## Popup

`popup/` should stay thin.

It should:

- request status from background
- issue commands to background
- keep popup-local UI state such as view selection, busy flags, and form inputs

It should not:

- reimplement workspace business logic
- derive separate business state from partial local assumptions

Relevant modules:

- [src/entrypoints/popup/hooks/use-popup-status.ts](/Users/zhongxi/code/other/ask-em/src/entrypoints/popup/hooks/use-popup-status.ts)
- [src/entrypoints/popup/App.tsx](/Users/zhongxi/code/other/ask-em/src/entrypoints/popup/App.tsx)

## Presentation Rules

User-visible display state should be derived in dedicated presentation helpers, then rendered by DOM/React layers.

Prefer:

- pure helpers produce labels, tones, and visual states
- UI layers only render those results

Avoid:

- hardcoded label toggling inside interaction handlers
- popup and content re-deriving the same provider/indicator text separately

Relevant modules:

- [src/content/indicator.ts](/Users/zhongxi/code/other/ask-em/src/content/indicator.ts)
- [src/utils/workspace-provider-display.ts](/Users/zhongxi/code/other/ask-em/src/utils/workspace-provider-display.ts)

## Change Checklist

When adding new state, ask:

1. Is this background business truth, shared domain logic, content-local runtime state, or popup-local UI state?
2. Does another layer already own this?
3. Is this state persistent, cross-tab, or purely presentational?
4. Can this be a pure derived value instead of a new mutable store?

If the answer is unclear, stop and decide ownership before coding.
