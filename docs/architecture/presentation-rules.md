last modified: 2026-04-13 23:32:08 +08

# Presentation Rules

This document defines how user-visible display state should be produced.

The goal is to avoid copy drift between popup, content UI, and future i18n work.

## Core Rule

Do not derive the same user-visible state in multiple UI layers.

Instead:

- use pure presentation helpers to compute labels, tones, and warning states
- let React and DOM layers render those results

## Preferred Shape

1. Runtime/domain state stays semantic
2. Presentation helpers map semantic state to UI-ready copy and tones
3. UI layers render the presentation object

Examples:

- [src/content/indicator.ts](/Users/zhongxi/code/other/ask-em/src/content/indicator.ts)
- [src/utils/workspace-provider-display.ts](/Users/zhongxi/code/other/ask-em/src/utils/workspace-provider-display.ts)

## Avoid

Avoid these patterns:

- changing indicator labels directly inside click handlers
- duplicating provider warning text in popup and content separately
- spreading the same tone/label decision across multiple files

## Good Boundaries

Good:

- `content/state.ts` decides which semantic inputs apply
- `content/indicator.ts` decides what text/tone those inputs produce
- `content/ui.ts` only renders the result

Good:

- popup cards consume provider presentation helpers
- popup components do not individually reinterpret provider issue states

## I18n Readiness

Before broad i18n rollout:

- every user-visible string should come from a small number of presentation helpers
- UI layers should not hardcode new business-state copy

This keeps future locale changes focused and reduces drift risk.

## Review Checklist

When adding a new user-visible state:

1. Is the state semantic or presentational?
2. Is there already a presentation helper that should own this?
3. Will popup and content need to show the same concept?
4. Can this be tested as a pure helper instead of only through UI wiring?
