#!/usr/bin/env bash
set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-uhzwqhaxnodtshlvvikt}"
ENV_FILE="${1:-supabase/functions.env}"

cd "$(dirname "$0")/.."

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE"
  echo "Create it from supabase/functions.env.example"
  exit 1
fi

echo "Uploading secrets from $ENV_FILE to Supabase ref: $PROJECT_REF"
npx supabase secrets set --env-file "$ENV_FILE" --project-ref "$PROJECT_REF"
