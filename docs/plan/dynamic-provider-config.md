# Dynamic Provider Config Plan

## Goal

Allow ask'em to react to provider DOM changes without shipping a full extension update for every selector/keyword breakage.

Scope for dynamic config:

- composer selectors
- send button selectors
- login keywords
- obvious error keywords
- timeouts / small numeric heuristics
- limited strategy flags

Out of scope for remote config:

- arbitrary executable logic
- remote JS
- unbounded selector behaviors

The extension should keep working with a built-in local config when remote config is unavailable.

## Current State

Provider adapters now share a common factory:

- [factory.ts](/Users/zhongxi/code/other/ask-em/src/adapters/factory.ts)

Each provider mostly supplies data-like config:

- selectors
- keywords
- timeouts
- a few provider-specific behavior hooks

This is a good base for remote config, but not enough yet. Some providers still need local behavior code, for example custom send-button lookup.

## Target Design

### 1. Split provider config into two layers

Local code should own a small set of strategy types.

Example:

```ts
type ProviderStrategy =
  | 'simple-selector'
  | 'deepseek-send-button-container'
  | 'prosemirror-composer';
```

Remote config should only choose among known strategies and provide parameters.

Example:

```ts
type RemoteProviderConfig = {
  version: string;
  provider: Provider;
  composerSelectors?: string[];
  sendButtonSelectors?: string[];
  loginKeywords?: string[];
  errorKeywords?: string[];
  submitWaitMs?: number;
  submitTimeoutMs?: number;
  composerStrategy?: string;
  sendButtonStrategy?: string;
};
```

Important rule:

- remote data may select behavior
- remote data must not define behavior

### 2. Keep a built-in default config

Each provider should keep a local default config in the extension bundle.

At runtime:

1. load local defaults
2. try to fetch remote config
3. validate remote config
4. merge validated fields onto local defaults
5. fall back to local defaults on any failure

This prevents remote outages from breaking the extension.

### 3. Add strict validation

Remote config must be validated before use.

Validation should include:

- provider must be known
- strategy names must be from a local allowlist
- selectors/keywords arrays must be bounded in size
- timeout values must be clamped to a safe range
- unknown fields must be ignored

Recommended implementation:

- add a small runtime validator/parser
- reject invalid configs instead of partially trusting them

### 4. Version the config

The remote payload should include:

- config version
- published timestamp
- optional minimum extension version

This allows:

- rollback
- debugging reports against a specific config version
- refusing incompatible configs

### 5. Cache locally

Store the last known good remote config in `chrome.storage.local`.

Suggested behavior:

- fetch on extension startup / first popup open / periodic background refresh
- use cached config if still fresh
- refresh in background
- keep built-in defaults as the ultimate fallback

### 6. Add observability

When remote config is involved, debug logs should record:

- remote config fetch started
- fetch success / failure
- config version applied
- validation failure reason
- fallback path used

Do not log full selector payloads unless debug mode is explicitly enabled.

## Recommended Implementation Phases

### Phase A: Prepare the adapter layer

Refactor adapter config into explicit typed config objects and strategy names.

Deliverables:

- local provider default config module
- strategy registry in code
- factory consumes typed config instead of ad hoc options

### Phase B: Add config loader

Introduce a runtime loader:

- load built-in config
- load cached config
- fetch remote config
- validate and merge

Keep this off by default behind a flag until stable.

### Phase C: Wire config into adapters

Replace hardcoded provider config literals with:

- built-in defaults
- runtime merged config

Keep custom provider-only functions local until they can be represented as strategies.

### Phase D: Add logging and failure handling

Add debug logging and clear fallback behavior.

### Phase E: Remote rollout

Start with selectors/keywords only. Do not remote-control more sensitive behavior until the config path has proven stable.

## Guardrails

- No remote code execution
- No provider-specific behavior defined by server-side JS
- Always preserve local fallback
- Reject invalid config loudly in debug logs, silently in UX
- Prefer additive merge over full replacement

## Open Questions

- Where should remote config be hosted?
- Do we want signed config payloads?
- How often should background refresh occur?
- Should remote config be applied immediately or only after next extension reload?

## Recommendation

The next concrete step should be:

1. introduce a typed `ProviderDomConfig`
2. separate strategy names from raw selectors
3. move current provider literals into a defaults module

That will make remote delivery straightforward without overcommitting to the network layer yet.
