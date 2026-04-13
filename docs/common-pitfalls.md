last modified: 2026-04-13 23:32:08 +08

# Common Pitfalls

## `stale` is internal-only

Debug/recovery signal. Not a blocked state. UI should render as ready.

## Popup polling must be silent

`refresh()` takes `{ silent?: boolean }`. Polling and side-effects must use `silent: true` — otherwise popup refreshes briefly flip `loading` and any `disabled={loading}` control flickers.
