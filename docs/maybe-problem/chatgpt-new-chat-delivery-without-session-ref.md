# ChatGPT new-chat delivery may report success without creating a session

## Context

Observed during the `good to go` set in `1.json`.

The expected behavior was:

1. User submits `good to go` from Claude.
2. ask'em opens a ChatGPT tab because no claimed ChatGPT tab is available.
3. The prompt is delivered to ChatGPT.
4. ChatGPT creates a new conversation URL under `/c/<sessionId>`.

What actually happened:

1. The ChatGPT tab was opened.
2. The ChatGPT content script started prompt delivery.
3. ChatGPT remained on the new-chat page.
4. No ChatGPT session ref update was observed.

## Log Evidence

Workspace:

```text
8bcc8323-a6b2-4c8b-838b-a7f308485eeb
```

Relevant sequence:

```text
Detected user submit
provider: claude
detail: good to go

Created workspace from new-chat submit
provider: claude
detail: chatgpt, claude, deepseek

Resolved delivery target
provider: chatgpt
detail: open-new-tab: no claimed tab was available for this provider

Delivering prompt
provider: chatgpt
detail: claude -> chatgpt @ new-chat

Starting prompt delivery in content
provider: chatgpt
detail: good to go
```

Missing expected follow-up:

```text
Observed session ref update
provider: chatgpt
detail: https://chatgpt.com/c/<sessionId>
```

Later evidence that the ChatGPT tab was still a new-chat page:

```text
Detached claimed tab from previous group on new-chat navigation
provider: chatgpt
workspaceId: 8bcc8323-a6b2-4c8b-838b-a7f308485eeb
```

## Likely Cause

This is probably not a tab-opening problem. The logs show that the ChatGPT tab was opened and the content script received the `DELIVER_PROMPT` message.

The more likely issue is that ChatGPT's composer submit did not actually create a conversation, while the content script still returned success.

Current delivery behavior:

1. `setComposerText(content)`
2. `composer.submit()`
3. start async `waitForSessionRefUpdate(...)` in the background
4. immediately return `{ ok: true }`

That means "attempted to submit" is treated as success. For new-chat delivery, this can produce a false positive if ChatGPT does not navigate to `/c/<sessionId>`.

Possible concrete causes:

- ChatGPT send-button selectors are stale or matching the wrong element.
- The button is visible but still not truly clickable after page hydration.
- The button uses `aria-disabled`, `data-disabled`, or another disabled state not covered by the current check.
- Programmatic text insertion updates the DOM but does not fully update ChatGPT's internal composer state.
- Click dispatch is accepted by the DOM but ignored by the app.

## Current Decision

Leave as-is for now.

The issue is documented because it can make the UI report a delivery as successful even though ChatGPT remains on new-chat.

## Possible Future Fix

If this becomes frequent, change new-chat delivery success criteria:

1. For `expectedSessionId === null` or `snapshot.pageKind === 'new-chat'`, wait for `waitForSessionRefUpdate(...)`.
2. Return `{ ok: true }` only after a session URL is observed.
3. Return `{ ok: false }` if no session ref appears before timeout.
4. Add finer ChatGPT submit diagnostics:
   - composer found or missing
   - send button selector matched
   - disabled / aria-disabled state
   - text after insertion
   - whether click or Enter fallback was used

This would avoid silent false positives and surface the issue through the existing sync failure indicator.
