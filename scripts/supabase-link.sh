#!/usr/bin/env bash
set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-uhzwqhaxnodtshlvvikt}"

cd "$(dirname "$0")/.."

echo "Linking project to Supabase ref: $PROJECT_REF"
npx supabase link --project-ref "$PROJECT_REF"
