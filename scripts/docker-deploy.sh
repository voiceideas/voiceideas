#!/usr/bin/env bash

set -euo pipefail

cd /workspace

./scripts/docker-bootstrap.sh
npm run build
npm run security:test

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is not clean. Commit or stash changes before running docker:deploy."
  exit 1
fi

BRANCH="$(git branch --show-current)"

if [ -z "$BRANCH" ]; then
  echo "Could not determine the current branch."
  exit 1
fi

git push origin "$BRANCH"
