# Source Capture Spike

## Decision

Use `window.postMessage` as the MAIN-world to isolated-world bridge for transient file input capture.

The MAIN-world hook should:

- Patch only transient `input[type=file]` elements.
- Read `Array.from(input.files ?? [])` on `change`.
- Post a narrow message to `window` with a namespaced marker and the `File[]`.
- Never include file bytes in debug logs.
- Be idempotent and expose teardown.

The isolated content script should:

- Listen for the same namespaced marker.
- Ignore messages that do not come from `window`.
- Validate that `files` is an array of `File` objects.
- Treat bridged files as source `transient-file-input`.

## Bridge Shape

```ts
type AskEmTransientFilesMessage = {
  source: 'ask-em';
  type: 'ASK_EM_TRANSIENT_FILES';
  files: File[];
};
```

## Fixture

Manual fixture: `docs/fixtures/source-capture-transient-input.html`.

The fixture creates a detached file input, triggers click, and posts the selected `File[]` back through `window.postMessage`. It is intentionally page-local so it can be opened directly in a browser and inspected without extension packaging.

## Risks Kept For Phase 3.5

- Real extension MAIN/isolated world behavior still must be verified in Chrome with the packaged content script.
- The production hook must keep the monkeypatch narrow and reversible.
- The production hook must not throw through page-owned `HTMLInputElement.prototype.click`.
