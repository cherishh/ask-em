# Login / Sync State Redesign

## Phase 1 — Login Detection And Source Gating
- [x] Tighten provider login detection for real-world logged-out variants
- [x] Treat logged-out current tabs as sync-ineligible sources
- [x] Fix Manus logged-out landing page detection and page-kind handling
- [x] Add focused tests for login detection / source gating

Acceptance:
- Logged-out source tabs do not create sets or fan out
- ChatGPT / Claude / Manus / DeepSeek logged-out pages are not reported as ready

## Phase 2 — Persist Sync Failures As Set Health
- [x] Add persistent workspace-level provider issue state
- [x] Record delivery failures as provider issues
- [x] Clear provider issues on successful recovery / successful delivery
- [x] Include provider issues in workspace summaries

Acceptance:
- A failed fan-out remains visible as set attention even if the target tab later disappears
- `all models synced` is impossible after a failed fan-out until the issue is cleared

## Phase 3 — Align Indicator And Popup / Pane Semantics
- [x] Make indicator derive set health from persistent issues plus current provider state
- [x] Replace internal terms like `no live tab` / `not connected` with user-facing semantics
- [x] Show recoverable missing tabs as `Will reopen on next sync`
- [x] Keep internal liveness states out of user-facing copy

Acceptance:
- Indicator only shows conclusions
- Popup / pane explains per-provider status and action

## Phase 4 — Regression Tests And Full Verification
- [x] Add regression coverage for logged-out targets and failed fan-out health
- [x] Add UI-state tests for indicator and popup/pane mappings
- [x] Run compile / test / build

Acceptance:
- Logged-out sync scenario is covered end to end in tests
- Full verification passes
