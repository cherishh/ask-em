# Recovery Semantics

This note captures the shared meaning of observed content `pageState` values during background
recovery and delivery target resolution.

## Terminal vs Retryable

During `waitForContentStatus(...)`, the background currently treats these states as terminal:

- `ready`
- `login-required`
- `error`

It does **not** treat `not-ready` as terminal.

Why:

- `ready` means delivery can proceed
- `login-required` means recovery reached a conclusive blocking state
- `error` means recovery reached a conclusive broken page state
- `not-ready` is still considered retryable within the polling window

## Recovery Failure Mapping

When background resolves a target tab and inspects the resulting content status:

- `ready` -> no recovery error
- `login-required` -> `${provider} login required`
- `error` -> `${provider} error page`
- `not-ready` or no response -> `${provider} not ready`

This keeps `tab-runtime` and `delivery-targets` aligned on the same meaning of provider readiness.

## Why This Exists

Without a shared rule, `waitForContentStatus(...)` and delivery target validation can silently drift:

- one place may start treating a state as terminal while another still collapses it into generic loading
- more specific failures such as provider error pages can get flattened into `not ready`

The shared helper in [recovery-semantics.ts](/Users/zhongxi/code/other/ask-em/src/background/recovery-semantics.ts)
is intended to keep these semantics explicit.
