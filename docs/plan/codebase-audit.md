last modified: 2026-04-13 23:32:08 +08

# Codebase Audit Plan

## Goal

Turn the current audit findings into a practical quality-improvement roadmap for ask'em.

This plan is not about rewriting the extension. The current high-level architecture is workable:

- background is the coordination center
- adapters isolate provider-specific DOM logic
- workspace state has a mostly clean domain layer

The main quality issues are elsewhere:

- popup UI is over-centralized
- content UI repeats display-state derivation in multiple places
- runtime, platform, and rendering boundaries are getting blurry
- some trust-sensitive product copy is now out of sync with actual behavior

The plan below is phased so we can improve quality without destabilizing the extension.

## Progress Snapshot

Current rollout status:

- Phase 0: completed
- Phase 1: completed
- Phase 2: substantially completed
- Phase 3: completed
- Phase 4: completed
- Phase 5: substantially completed
- Phase 6: in progress

The findings below are the original audit inputs. Some of them have already been addressed by the work above.

## Current Findings

### 1. Trust and legal copy drift

The popup legal/privacy copy is no longer aligned with product behavior.

Relevant files:

- [App.tsx](/Users/zhongxi/code/other/ask-em/src/entrypoints/popup/App.tsx)
- [use-feedback.ts](/Users/zhongxi/code/other/ask-em/src/entrypoints/popup/hooks/use-feedback.ts)
- [use-provider-request.ts](/Users/zhongxi/code/other/ask-em/src/entrypoints/popup/hooks/use-provider-request.ts)

Examples:

- privacy text says no data is transmitted to external servers
- feedback can send user-entered feedback and optional logs to a remote support endpoint
- request-more-models can submit data to a remote endpoint

This is the highest-priority quality issue because it affects user trust, not just code shape.

### 2. Popup is too monolithic

[App.tsx](/Users/zhongxi/code/other/ask-em/src/entrypoints/popup/App.tsx) currently mixes:

- page shell
- view routing
- modal orchestration
- workspace rendering
- settings rendering
- dev tools
- onboarding
- legal text
- some local persistence behavior

This makes small changes expensive and increases regression risk.

### 3. Display logic has more than one source of truth

Indicator and provider-display copy is derived in multiple places:

- [indicator.ts](/Users/zhongxi/code/other/ask-em/src/content/indicator.ts)
- [workspace-provider-display.ts](/Users/zhongxi/code/other/ask-em/src/utils/workspace-provider-display.ts)
- [ui-render.ts](/Users/zhongxi/code/other/ask-em/src/content/ui-render.ts)
- popup components under [src/entrypoints/popup/components](</Users/zhongxi/code/other/ask-em/src/entrypoints/popup/components>)

This is a real maintenance risk. Once copy changes, issue states evolve, or i18n begins, drift is likely.

### 4. Directory boundaries are no longer crisp

`runtime/` currently mixes pure state logic with browser/platform orchestration.

Examples:

- [workspace.ts](/Users/zhongxi/code/other/ask-em/src/runtime/workspace.ts) is a clean domain-state module
- background recovery/tab orchestration now lives under [src/background](</Users/zhongxi/code/other/ask-em/src/background>), which is healthier than before but still worth guarding

`utils/` is less overloaded than before, but shared presentation helpers still need deliberate ownership.

### 5. Popup refresh model is wasteful

[use-popup-status.ts](/Users/zhongxi/code/other/ask-em/src/entrypoints/popup/hooks/use-popup-status.ts) still relies on polling and explicit refreshes, even though the polling is now lighter than it was originally.

This is simple, but not elegant:

- repetitive sendMessage + refresh patterns
- extra background chatter
- unnecessary refresh churn while popup is open

### 6. Some smaller cleanup items remain

Examples:

- redundant recalculation in [settings.ts](/Users/zhongxi/code/other/ask-em/src/background/settings.ts)
- stale docs or architecture notes after structural refactors
- helper modules without direct unit tests after extraction

These are not urgent by themselves, but they signal code hygiene debt.

## Principles

The next iterations should follow these rules:

1. Do not rewrite working coordination logic without a concrete gain.
2. Separate domain state, browser/platform effects, and presentation concerns.
3. Keep background as the source of truth for extension state.
4. Keep popup state lightweight; do not create a second business-state system there.
5. Centralize display derivation before adding i18n.
6. Prefer refactors that reduce ambiguity over refactors that only improve aesthetics.

## Phase 0: Correctness and Trust

### Goal

Fix the highest-risk mismatches between what the product does and what the UI/legal copy says.

### Scope

- update privacy / legal / feedback copy to match current support-endpoint flows
- audit user-visible claims about local-only storage and remote transmission
- review settings/help text for outdated behavior

### Deliverables

- legal copy moved out of `App.tsx`
- product copy reflects current remote feedback/request flows
- no user-visible copy contradicts actual behavior

### Not in scope

- i18n
- full legal rewrite with external counsel
- backend redesign

### Exit criteria

- there is no known user-facing statement that is false as of current behavior

## Phase 1: Popup Decomposition

### Goal

Break the popup into composable pieces without changing behavior.

### Scope

Split [App.tsx](/Users/zhongxi/code/other/ask-em/src/entrypoints/popup/App.tsx) into a small shell plus focused components.

Recommended shape:

- `popup/views/HomeView.tsx`
- `popup/views/AdvancedView.tsx`
- `popup/views/LegalView.tsx`
- `popup/components/WorkspaceCard.tsx`
- `popup/components/WarningCard.tsx`
- `popup/components/ShortcutRecorder.tsx`
- `popup/components/OnboardingCard.tsx`
- `popup/components/DevToolsModal.tsx`

Also extract:

- legal text into its own module
- dev-control persistence into a hook or effect

### Deliverables

- `App.tsx` becomes a view shell and wiring layer
- render-time `localStorage` mutation is removed
- large inline content blocks are moved out

### Not in scope

- changing popup visual design
- changing business logic semantics

### Exit criteria

- `App.tsx` is materially smaller and easier to scan
- no large feature sections or legal text remain inline in the root component

## Phase 2: Unify Presentation State

### Goal

Make indicator and provider display logic come from one presentation layer per feature.

### Scope

Refactor duplicated text/status derivation across:

- [content-indicator.ts](/Users/zhongxi/code/other/ask-em/src/utils/content-indicator.ts)
- [workspace-provider-display.ts](/Users/zhongxi/code/other/ask-em/src/utils/workspace-provider-display.ts)
- [content-ui.ts](/Users/zhongxi/code/other/ask-em/src/utils/content-ui.ts)
- popup display helpers in [App.tsx](/Users/zhongxi/code/other/ask-em/src/entrypoints/popup/App.tsx)

Recommended direction:

- pure state helpers produce semantic presentation objects
- DOM and React layers only render them
- no direct hardcoded label toggling inside content UI interaction handlers

### Deliverables

- one source of truth for pill labels and sync sublabels
- one source of truth for workspace provider display states
- popup stops re-deriving the same display object three times

### Not in scope

- i18n implementation
- content UI redesign

### Exit criteria

- copy/state drift between popup and content UI is meaningfully reduced
- new display copy changes only need to be made in one place per feature

## Phase 3: Clarify Boundaries

### Goal

Make the codebase easier to reason about by separating domain logic from platform/runtime orchestration.

### Scope

Restructure modules so that:

- pure state transitions live in a domain-style layer
- Chrome/tab/content messaging orchestration lives in a platform/background layer
- content rendering lives in a content-specific area instead of generic `utils`

Recommended direction:

- keep `runtime/protocol.ts` as shared types/contracts
- evolve `runtime/workspace.ts` into explicit domain state
- move browser-facing recovery helpers out of `runtime/`
- replace broad `utils/content-*` grouping with a clearer `content/` boundary over time

Possible future structure:

- `src/domain/`
- `src/platform/`
- `src/content/`
- `src/popup/`
- `src/background/`

This does not need to happen in one big rename. It can be incremental.

### Deliverables

- clearer ownership of each module type
- fewer files that mix pure transforms with browser effects

### Not in scope

- full repo rewrite
- adapter redesign unless needed by the boundary cleanup

### Exit criteria

- engineers can more easily answer:
  - where state truth lives
  - where tab orchestration lives
  - where rendering logic lives

## Phase 4: Background and Content Simplification

### Goal

Reduce complexity in the highest-branching orchestration paths.

### Scope

Focus on:

- [delivery.ts](/Users/zhongxi/code/other/ask-em/src/background/delivery.ts)
- [presence.ts](/Users/zhongxi/code/other/ask-em/src/background/presence.ts)
- [recovery-semantics.ts](/Users/zhongxi/code/other/ask-em/src/background/recovery-semantics.ts)
- [state.ts](/Users/zhongxi/code/other/ask-em/src/content/state.ts)

Recommended direction:

- split delivery orchestration into smaller services
- make recovery semantics preserve richer page states
- gradually make content-side state transitions more explicit
- document soft-detach vs hard-failure semantics where needed

Possible sub-slices:

1. extract delivery result classification
2. extract target resolution / recovery policy
3. reduce closure-based mutable state in content bootstrap paths
4. define explicit page-state terminal handling

### Deliverables

- smaller orchestration functions
- fewer cross-cutting conditionals in single files
- more explicit state transitions for content-side behavior

### Not in scope

- changing core product behavior unless fixing a bug

### Exit criteria

- edge-case fixes in sync/recovery do not require editing one giant decision tree every time
- Status: completed. The remaining work here is no longer major structural debt.

## Phase 5: Popup Data Flow and Performance

### Goal

Reduce unnecessary refresh churn and simplify popup actions.

### Scope

Improve [use-popup-status.ts](/Users/zhongxi/code/other/ask-em/src/entrypoints/popup/hooks/use-popup-status.ts).

Recommended direction:

- replace unconditional 1200ms polling with a lighter model
- prefer explicit refresh after commands
- consider slower or visibility-aware polling if background push is not worth adding
- extract repeated message + refresh action wrappers

### Deliverables

- simpler popup command flow
- less repetitive code in popup hooks
- lower background chatter while popup is open

### Not in scope

- adding a global client-side state library
- building a large event bus unless truly needed

### Exit criteria

- popup state updates feel simpler and are easier to trace
- Status: substantially completed. Polling is lighter and visibility-aware, but popup data flow can still be polished further.

## Phase 6: Hygiene and Guardrails

### Goal

Keep the cleaned-up structure from decaying again.

### Scope

- remove stale TODOs and dead components
- add small tests around presentation helpers
- add lightweight conventions for where new user-visible copy belongs
- add comments or docs for the most important state boundaries

### Deliverables

- dead code removed
- stale fallback branches reviewed
- docs updated for state ownership and UI presentation rules

### Exit criteria

- future contributors have fewer easy ways to reintroduce the same structural problems
- Status: in progress. Core docs and helper tests exist now; this phase remains a maintenance pass, not a blocker.

## Recommended Execution Order

The best order is:

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 6 cleanup pass for touched areas
5. Phase 3
6. Phase 4
7. Phase 5
8. i18n work after presentation boundaries are cleaner

Reason:

- trust fixes should not wait
- popup decomposition is the cheapest structural win
- presentation unification should happen before i18n
- boundary cleanup should precede deeper state refactors

## What We Should Not Do

- do not introduce a new global state library just to mask current boundaries
- do not rewrite background coordination from scratch
- do not mix i18n rollout with structural cleanup in the same large change
- do not move files around without first defining the target ownership model

## Success Criteria

We can consider this audit plan successful when:

- user-visible behavior and copy match reality
- popup root complexity is materially lower
- display-state derivation is centralized
- domain vs platform ownership is easier to understand
- background/content orchestration is easier to modify safely
- the codebase is in a better position to support i18n and future features
