# Auth Detection Refactor

## Phase 1 — Structural Auth Signals For Gemini / DeepSeek / Claude
- [x] Add shared DOM helpers for visible auth buttons, headings, and credential inputs
- [x] Replace Gemini `loginKeywords` with structure-based auth detection
- [x] Replace DeepSeek `loginKeywords` with structure-based auth detection
- [x] Replace Claude `loginKeywords` with structure-based auth detection
- [x] Add pure tests for Gemini / DeepSeek / Claude auth rules

Acceptance:
- Gemini logged-out `/app` is `login-required` because visible `Sign in` exists, regardless of composer
- DeepSeek logged-out `/sign_in` is `login-required` from URL / auth form signals
- Claude logged-out `/login` is `login-required` from URL / visible auth CTA signals
- No phase-1 provider relies on whole-page keyword scanning for auth

## Phase 2 — Structural Auth Signals For ChatGPT / Manus
- [x] Replace ChatGPT body-text auth detection with visible CTA / account-chooser signals
- [x] Replace Manus auth detection with visible nav CTA signals
- [x] Remove provider-specific fallback dependence on whole-page keyword scans where possible
- [x] Expand pure auth-rule tests for ChatGPT / Manus

Acceptance:
- ChatGPT account chooser on `/` is `login-required` without reading full-page transcript text
- Manus landing page with visible `Sign in` / `Sign up` is `login-required` even if composer exists

## Phase 3 — Structured Auth Classification Logging
- [x] Log which auth rule fired on each provider when local page state changes to `login-required`
- [x] Include URL, pageKind, and structural signals summary in the debug entry
- [x] Keep logs low-noise: only log on state transitions

Acceptance:
- A future `login-required` misclassification can be diagnosed from logs alone

## Phase 4 — Delivery Confirmation Follow-up
- [x] Split target delivery `accepted` vs `confirmed`
- [x] Treat missing session-ref confirmation on new-chat targets as failed sync health
- [x] Persist late failures back into workspace issues

Acceptance:
- `all models synced` is impossible after a late target confirmation failure
- ChatGPT-style delayed session-ref failures become persistent set attention
