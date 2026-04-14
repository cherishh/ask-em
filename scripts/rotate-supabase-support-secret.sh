#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_REF="${SUPABASE_PROJECT_REF:-}"
SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

if ! command -v supabase >/dev/null 2>&1; then
  echo "supabase CLI is required." >&2
  exit 1
fi

if [[ -z "${PROJECT_REF}" ]]; then
  echo "Missing SUPABASE_PROJECT_REF." >&2
  echo "Example: export SUPABASE_PROJECT_REF=usrlcmprpkldlzisxunf" >&2
  exit 1
fi

if [[ -z "${SERVICE_ROLE_KEY}" ]]; then
  echo "Missing SUPABASE_SERVICE_ROLE_KEY." >&2
  echo "Example: export SUPABASE_SERVICE_ROLE_KEY=..." >&2
  exit 1
fi

echo "Setting SUPABASE_SERVICE_ROLE_KEY on project ${PROJECT_REF}..."
supabase secrets set \
  --project-ref "${PROJECT_REF}" \
  SUPABASE_SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY}"

echo "Deploying support function..."
supabase functions deploy support \
  --project-ref "${PROJECT_REF}" \
  --no-verify-jwt \
  --workdir "${ROOT_DIR}/supabase"

echo "Done."
echo "Health check:"
echo "  https://${PROJECT_REF}.functions.supabase.co/support/health"
