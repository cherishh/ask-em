# ask'em

Type a prompt in one AI chat, send it to all of them.

ask'em is a Chrome (MV3) extension that mirrors a prompt you submit in one AI chat
provider out to the other enabled providers in the same workspace. The provider you
type in still sends natively; ask'em fans the **same prompt — text and attachments —**
out to the targets by replaying it into each one's composer.

## Supported providers

Six today, more on the way.

| Provider | Host |
|----------|------|
| Claude   | `claude.ai` |
| ChatGPT  | `chatgpt.com` |
| Gemini   | `gemini.google.com` |
| DeepSeek | `chat.deepseek.com` |
| Manus    | `manus.im` |
| Grok     | `grok.com` |

## How it works

- **Capture** — a content script observes your submit (Enter / send button) and reads
  the composer text plus any attachments (paste, drop, file input, or transient
  detached inputs).
- **Coordinate** — the background service worker resolves the workspace, decides which
  providers to fan out to, and tracks per-provider delivery status.
- **Deliver** — for each target tab, an adapter replays the prompt into that provider's
  composer (synthetic paste / scoped file input / transient input) and confirms the
  result before submitting.

Attachments ride a dedicated transport: base64 chunks on the wire, raw bytes at rest in
IndexedDB, bounded by per-file / total / count / TTL budgets, and released as soon as the
fan-out for a submit completes. See [`docs/plan/attachment-sync.md`](docs/plan/attachment-sync.md)
for the full design.

## Project layout

```
src/
  adapters/     per-provider DOM strategy (capture, delivery, presence) + factory
  background/   coordination: workspaces, delivery, settings, issues
  content/      page-local capture, delivery controller, indicator UI
  runtime/      shared contracts, message protocol, attachment store, pure transforms
  entrypoints/  WXT entrypoints (content scripts, background, popup)
  styles/       content + popup CSS
docs/           architecture notes, design plans, pitfalls
```

State ownership (background owns coordination, runtime owns contracts, content/popup own
local UI) is documented in [`docs/architecture/state-ownership.md`](docs/architecture/state-ownership.md).

## Develop

Requires Node + [pnpm](https://pnpm.io). Built with [WXT](https://wxt.dev), React 19, and
TypeScript.

```bash
pnpm install
cp .env.example .env.local   # set WXT_SUPPORT_API_BASE_URL for the feedback endpoint
pnpm dev                     # launches Chrome with the extension loaded (HMR)
```

| Script | Purpose |
|--------|---------|
| `pnpm dev` | Run the extension in dev mode |
| `pnpm build` | Production build |
| `pnpm package:chrome` | Production Chrome build and Web Store zip |
| `pnpm test` | Run the Vitest suite |
| `pnpm compile` | Type-check (`tsc --noEmit`) |
| `pnpm lint` | ESLint |

The only Chrome API permission requested is `storage`. Host access is limited to the
supported AI chat providers so the extension can run its content scripts there. The
support/feedback endpoint configured in `.env.local` is requested only as an optional
host permission when you submit feedback or provider requests.

## Configuration

`.env.local` (see `.env.example`) wires up the feedback/support backend:

- `WXT_SUPPORT_API_BASE_URL` — Supabase Edge Function serving feedback (`pnpm support:dev` runs it locally).
- `WXT_FEEDBACK_ENDPOINT`, `WXT_MORE_PROVIDERS_REQUEST_ENDPOINT` — optional overrides.

Sync behavior (global on/off, default fan-out providers, pause after first fan-out,
auto-sync new chats, diagnostics) is controlled from the extension popup.

## License

Copyright (C) 2026 Tuxi.

ask'em is free software licensed under the **GNU Affero General Public License v3.0**
(AGPL-3.0) — see [`LICENSE`](LICENSE). You may use, study, share, and modify it; if you
distribute it or run a modified version as a network service, you must make your source
available under the same license.

A separate **commercial license** is available for uses that the AGPL does not permit
(e.g. shipping a closed-source product built on ask'em). Contributions are accepted
under maintainer-controlled licensing terms so this dual-licensing option stays open —
see [`CONTRIBUTING.md`](CONTRIBUTING.md) before submitting changes.
