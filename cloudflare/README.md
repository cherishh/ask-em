# Cloudflare Setup

This worker stores `Request more models` submissions and popup feedback in Cloudflare D1.

## Files

- `cloudflare/wrangler.jsonc`: Worker config
- `cloudflare/src/index.js`: Worker routes
- `cloudflare/migrations/0001_create_model_requests.sql`: D1 schema

## One-time setup

1. Log in to Cloudflare:

```bash
pnpm cf:login
```

2. Create the D1 database:

```bash
pnpm cf:d1:create
```

3. Copy the returned database ID into `cloudflare/wrangler.jsonc`:

- replace `database_id`
- replace `preview_database_id`

4. Apply the schema:

```bash
pnpm cf:d1:migrate:remote
```

5. Deploy the worker:

```bash
pnpm cf:deploy
```

6. Copy the deployed endpoint into `.env.local`:

```bash
WXT_MORE_PROVIDERS_REQUEST_ENDPOINT="https://your-subdomain.workers.dev/requests/models"
```

## Local development

Start the worker locally:

```bash
pnpm cf:dev
```

Apply migrations to the local D1 database:

```bash
pnpm cf:d1:migrate:local
```

## Routes

- `POST /requests/models`
  - body: `{ "requestedProviders": string[], "extensionVersion"?: string }`
- `GET /requests/models/stats`
  - returns aggregate request counts by provider
- `POST /feedback`
  - body: `{ "message": string, "includeLogs": boolean, "logs"?: unknown[], "extensionVersion"?: string }`
