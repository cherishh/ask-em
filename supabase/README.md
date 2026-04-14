# Supabase Support Backend

This project uses:

- `Supabase Edge Functions` for the public HTTP endpoint
- `Supabase Postgres` for storing feedback and provider requests

## Layout

- [functions/support/index.ts](./functions/support/index.ts): public support endpoint
- [migrations/20260414_support_tables.sql](./migrations/20260414_support_tables.sql): schema
- [config.toml](./config.toml): local Supabase config

## Routes

The single `support` function exposes:

- `GET /support/health`
- `POST /support/feedback`
- `POST /support/requests/providers`
- `GET /support/requests/providers/stats`

## Extension env

Set the extension env to the function base URL:

```bash
WXT_SUPPORT_API_BASE_URL="https://your-project-ref.functions.supabase.co/support"
```

The extension derives the rest from that base.

## Setup

1. Create a Supabase project.
2. Install Supabase CLI locally or globally.
3. Apply [migrations/20260414_support_tables.sql](./migrations/20260414_support_tables.sql).
4. Set the function secret:

```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
```

5. Deploy the function:

```bash
supabase functions deploy support --no-verify-jwt
```

## Local dev

```bash
supabase start
supabase db push
supabase functions serve support --no-verify-jwt
```

## Notes

- `--no-verify-jwt` keeps the endpoint public, which matches the current browser-extension flow.
- The Supabase `anon` key is not used by this support flow.
- The service role key stays server-side only. Do not put it in the extension.
- If abuse becomes a problem later, add rate limiting or Turnstile at the function layer.
