last modified: 2026-09-06 +08

# Recovery Semantics

This note captures the shared meaning of observed content `pageState` values during background
recovery and delivery target resolution.

## Terminal vs Retryable

During `waitForContentStatus(...)`, the background currently treats these states as terminal:

- `ready`
- `login-required`
- `error`
- `private-mode`
- `read-only`

It does **not** treat `not-ready` as terminal.

Why:

- `ready` means delivery can proceed
- `login-required` means recovery reached a conclusive blocking state
- `error` means recovery reached a conclusive broken page state
- `private-mode` and `read-only` mean this page must not receive prompts
- `not-ready` is still considered retryable within the polling window

## Recovery Failure Mapping

The shared status validator maps observations as follows:

- `ready` -> no recovery error
- `login-required` -> `${provider} login required`
- `error` -> `${provider} error page`
- `private-mode` -> `${provider} private chat`
- `read-only` -> `${provider} read-only page`
- `not-ready` or no response -> `${provider} not ready`

Delivery target resolution gives the content script 40 seconds to become ready, including the
time before it starts responding. New tabs poll content readiness directly instead of first waiting
for the document's load event. A ready editor can be used while unrelated page resources still load.
When navigating an existing tab, the document-load wait is retained so the old document cannot be
mistaken for the destination; that wait counts toward the same 40-second readiness budget.

If the window expires, delivery throws an explicit readiness timeout including the last observed
state and the fact that the prompt was not sent. This maps to the durable `delivery-failed` issue,
not the transient `loading` issue. A later ready heartbeat does not imply that the missed prompt
was delivered. The popup prioritizes this completed failure over a still-loading page state.

The delivery executor claims a selected target before readiness polling starts. Presence messages
from the new tab can therefore reach its workspace even when loading outlasts the delivery window.
A claimed, unbound new-chat page that is still preparing is reused rather than opening another tab.
No prompt is injected until readiness and any expected session are validated; timeout does not queue
an automatic resend.

The September 6 Grok trace exposed this distinction: the old 15-second readiness window ended,
Grok became ready 3.7 seconds later, and the eventual fan-out result persisted `loading` even though
the delivery attempt had already ended. `src/background/grok-readiness.test.ts` covers delayed
readiness, claim association, timeout/heartbeat ordering, and immediate terminal failures.

## Why This Exists

Without a shared rule, `waitForContentStatus(...)` and delivery target validation can silently drift:

- one place may start treating a state as terminal while another still collapses it into generic loading
- more specific failures such as provider error pages can get flattened into `not ready`

The shared helper in [recovery-semantics.ts](../../src/background/recovery-semantics.ts)
is intended to keep these semantics explicit.
