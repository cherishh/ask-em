last modified: 2026-04-13 23:32:08 +08

# Provider invalid-session fallback may be misclassified or falsely confirmed

## Context

Observed from the captured log in:

- [log.json](/Users/zhongxi/code/other/ask-em/docs/maybe-problem/provider-invalid-session-fallback/log.json)

This family of problems happens when a provider is asked to open a session URL that no longer exists.

The provider may react in more than one way:

1. show an obvious error page such as `404` or `Page not found`
2. silently fall back to home / blank chat
3. keep the old session-like URL, but render a blank-chat surface anyway

The third case is the most dangerous one.

## What We Know Today

### Case A: provider falls back to a real new-chat URL

Example:

- ChatGPT falls back to `/`
- Claude falls back to `/new` or another blank-chat route

Current behavior:

1. content presence usually reports `pageKind = new-chat` and `sessionId = null`
2. background detaches the claimed tab from the previous set
3. the tab is no longer treated as the bound session tab

This part is acceptable.

However, on the next sync, recovery still tries to reopen the old bound session URL from workspace state.

If the provider keeps redirecting that invalid session URL back to a blank-chat page, we currently fail with a generic mismatch / delivery failure path.

So for this case:

- detecting tab detachment is mostly fine
- automatic recovery back into the old set is not always friendly

### Case B: provider keeps the old URL but renders blank-chat content

Example called out explicitly:

- Gemini may keep `/app/<stale-session-id>` in the URL
- but the page content behaves like a fresh new chat

Current behavior is risky here because several parts of the system trust URL-derived session identity:

1. `extractSessionId(url)` still returns the stale session id
2. `pageKind` still looks like `existing-session`
3. if the composer exists and no obvious error copy is detected, `pageState` becomes `ready`

That means the extension may treat the page as a valid existing session even though the actual UI has already fallen back to a fresh chat surface.

This can lead to a false-positive delivery:

- prompt is delivered into what is effectively a new chat
- runtime still believes it reached the expected old session
- workspace binding stays attached to a session identity that is no longer real

## Evidence From log.json

The captured log shows one clear invalid-session symptom for Claude:

```text
Observed local page state change
provider: claude
detail: ready -> not-ready (existing-session) @ https://claude.ai/chat/36c17528-8b8a-4bd3-9d25-9daf608eb81f

Prompt delivery threw
provider: claude
detail: claude not ready
```

This is consistent with a dead session URL that no longer resolves to a usable chat surface.

The same log also shows the more recoverable fallback pattern on ChatGPT:

```text
Detached claimed tab from previous group on new-chat navigation
provider: chatgpt
```

That means ChatGPT clearly exposed the fallback as a new-chat navigation, which the system can at least recognize as a detach.

## Current Classification

The codebase currently behaves like this:

- obvious 404 / error pages can now be detected as `error` / `error-page`
- generic unusable pages still become `not-ready` / `loading`
- URL-preserving fallback-to-blank-chat is still vulnerable to false confirmation

So the current state is:

- better for obvious error pages
- still weak for silent fallback surfaces
- especially weak for Gemini-like stale URL + blank content scenarios

## Why This Matters

If the provider visibly shows an error page, the user gets a reasonable warning.

If the provider silently falls back, the user experience can be worse:

- ask'em may think a sync target is still valid
- the next prompt may land in the wrong chat
- the set may continue to point to a dead or replaced session

This is not just a wording problem. It is a session-identity problem.

## Possible Future Fix

The next improvement should be provider-specific invalid-session detection, especially for Gemini-like flows.

Promising directions:

1. add a provider-level concept of `blank-chat surface` that is not derived only from URL
2. for existing-session URLs, verify that the page UI still looks like a real existing conversation
3. if URL says `existing-session` but UI looks like fresh blank chat, treat the page as invalid for that bound session
4. fail delivery instead of confirming it
5. mark the member as needing attention instead of silently keeping the stale binding

In other words:

- URL alone should not be the only source of truth for session validity

## Current Decision

Document this for later.

The issue is real, especially for providers that do not expose invalid sessions through a clean 404 or clean redirect to home.
