# Refactor Todo

This branch is for structural cleanup. Default rule: behavior-preserving refactors first, feature work second.

## Guardrails

- Keep each phase shippable.
- Prefer extraction and consolidation over redesign.
- Do not change product behavior unless the phase explicitly calls for it.
- Run `pnpm compile`, `pnpm test`, and `pnpm build` at the end of every phase.
- Land tests or test refactors together with the code they protect.

## Phase 1: Storage Safety

Goal: remove read-modify-write races around `chrome.storage`.

- [x] Add a serialized write queue for local/session state updates.
- [x] Route `set/updateLocalState` and `set/updateSessionState` through the queue.
- [x] Keep the public storage API small and consistent.
- [x] Add focused tests for concurrent updates, especially debug logs and claimed tabs.

Success criteria:

- No direct read-modify-write races remain in storage helpers.
- Existing tests still pass.
- New concurrency tests cover the queue behavior.

## Phase 2: Background Decomposition

Goal: split the background god file by responsibility without changing behavior.

- [x] Extract message routing bootstrap from `src/entrypoints/background.ts`.
- [x] Extract presence/claim reconciliation.
- [x] Extract submit routing + workspace creation flow.
- [x] Extract delivery fan-out + sync progress notifications.
- [x] Extract workspace status builders and popup/settings handlers.
- [x] Extract GC / cleanup scheduling helpers.
- [x] Keep one thin `background.ts` entrypoint that wires modules together.

Success criteria:

- `background.ts` becomes mostly imports + event wiring.
- No logic duplication is introduced during extraction.
- Behavior remains unchanged.

## Phase 3: Claimed-Tab Lifecycle Consolidation

Goal: unify the detach/transfer/keep rules so presence and submit use the same source of truth.

- [x] Introduce a single claimed-tab transition classifier.
- [x] Remove duplicated orchestration between presence and submit paths.
- [x] Cover new-chat, foreign-session, unresolved-session, and transfer cases with tests.
- [x] Keep existing edge-case behavior intact.

Success criteria:

- There is one central place to reason about claimed-tab transitions.
- Presence and submit paths no longer drift independently.

## Phase 4: Content Bootstrap Split

Goal: turn `content-bootstrap.ts` into wiring code instead of a monolithic controller.

- [x] Extract presence controller.
- [x] Extract submit controller and echo-suppression logic.
- [x] Extract delivery controller / runtime message handling.
- [x] Extract shared content state shape where needed.
- [x] Add teardown ownership so listeners/timers are clearly managed.

Success criteria:

- `bootstrapContentScript()` mostly composes controllers.
- Timers/listeners are owned and cleaned up explicitly.
- Indicator behavior remains unchanged.

## Phase 5: Content UI Cleanup

Goal: reduce fragility in `content-ui.ts`.

- [ ] Split injected styles, pill rendering, tooltip rendering, and panel rendering.
- [ ] Replace the largest `innerHTML` blocks with smaller render helpers or DOM builders.
- [ ] Add an explicit `destroy()` path for listeners if useful.
- [ ] Keep the current UX exactly the same.

Success criteria:

- `content-ui.ts` is materially smaller.
- UI wiring is easier to read and test.
- No user-facing UI regressions.

## Phase 6: Adapter Consolidation

Goal: remove repetitive provider adapter boilerplate while keeping provider-specific selectors local.

- [ ] Introduce a shared DOM adapter factory or shared composer/session helpers.
- [ ] Move common submit subscription logic into shared code.
- [ ] Keep provider-specific selectors, login keywords, and error heuristics configurable.
- [ ] Add or update adapter-level tests where needed.

Success criteria:

- The four provider adapters are substantially smaller.
- Shared behavior lives in one place.
- Provider-specific quirks stay readable.

## Phase 7: Popup Decomposition

Goal: split `App.tsx` into hooks + focused components.

- [ ] Extract popup status polling hook.
- [ ] Extract shortcut settings hook/component.
- [ ] Extract request modal flow.
- [ ] Extract diagnostics/log actions flow.
- [ ] Extract legal/feedback modal boundaries if still needed.

Success criteria:

- `App.tsx` becomes a composition file, not a logic dump.
- State domains are easier to reason about independently.

## Phase 8: Protocol and Runtime Types Cleanup

Goal: separate domain types from runtime transport types.

- [ ] Split storage/domain types from runtime request/response messages.
- [ ] Move constants and shortcut helpers into narrower modules.
- [ ] Tighten response/request typing where possible.

Success criteria:

- `protocol.ts` is no longer the dumping ground for everything.
- Message contracts are easier to navigate.

## Phase 9: Test Builders and Coverage Cleanup

Goal: make tests cheaper to extend.

- [ ] Add `LocalState` / `SessionState` / workspace builders for tests.
- [ ] Remove repeated fixture setup in large test files.
- [ ] Keep behavior-focused tests readable.
- [ ] Fill any gaps created by earlier refactors.

Success criteria:

- Test setup duplication drops materially.
- New cases are easier to add.

## Phase 10: Low-Risk Hygiene

Goal: clear smaller non-best-practices once the structural work is done.

- [ ] Replace `sort(() => Math.random() - 0.5)` with Fisher-Yates.
- [ ] Review swallowed runtime-message errors and improve observability where useful.
- [ ] Re-scan styles and small utilities for duplicated patterns after code refactors settle.

Success criteria:

- Small known anti-patterns are cleaned up.
- No broad style or architecture churn is mixed into larger phases.

## Execution Order

Recommended order:

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5
6. Phase 6
7. Phase 7
8. Phase 8
9. Phase 9
10. Phase 10

## Notes

- Do not combine Phase 2 and Phase 3 into one commit. Extraction first, behavior consolidation second.
- Do not mix popup refactors with content refactors in the same pass.
- If a phase exposes a real bug, fix it in that phase and note it in the commit message.
