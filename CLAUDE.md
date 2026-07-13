# Project Instructions

## Release packaging

- Before creating any release package, increment the extension version first.
- Unless the user specifies another version, increment the patch version by default (for example, `0.1.3` to `0.1.4`).
- Keep the versions in `package.json` and `wxt.config.ts` synchronized, then run `pnpm package:chrome`.
