#!/usr/bin/env bash
set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-uhzwqhaxnodtshlvvikt}"

cd "$(dirname "$0")/.."

echo "Deploying Edge Functions to Supabase ref: $PROJECT_REF"
npx supabase functions deploy accept-idea-invite --project-ref "$PROJECT_REF"
npx supabase functions deploy organize --project-ref "$PROJECT_REF"
npx supabase functions deploy share-idea --project-ref "$PROJECT_REF"
npx supabase functions deploy transcribe --project-ref "$PROJECT_REF"
