# Common Pitfalls

## `stale` is internal-only

Debug/recovery signal. Not a blocked state. UI should render as ready.

## Popup polling must be silent

`refresh()` takes `{ silent?: boolean }`. Polling and side-effects must use `silent: true` — otherwise `loading` flips every 1.2s and any `disabled={loading}` control flickers.
