#!/usr/bin/env bash

set -euo pipefail

cd /workspace

if [ -f .git ]; then
  GITDIR_LINE="$(cat .git)"
  if [[ "$GITDIR_LINE" == gitdir:\ * ]]; then
    EXPECTED_GITDIR="${GITDIR_LINE#gitdir: }"
    EXPECTED_COMMON_GIT_DIR="$(dirname "$(dirname "$EXPECTED_GITDIR")")"
    EXPECTED_COMMON_WORKTREE_ROOT="$(dirname "$EXPECTED_COMMON_GIT_DIR")"
    if [ ! -e "$EXPECTED_COMMON_GIT_DIR" ] && [ -d /workspace/.git-main ]; then
      mkdir -p "$EXPECTED_COMMON_WORKTREE_ROOT"
      ln -s /workspace/.git-main "$EXPECTED_COMMON_GIT_DIR"
    fi
  fi
fi

STAMP_FILE="node_modules/.package-lock.sha256"
CURRENT_HASH="$(node --input-type=module -e "import { createHash } from 'node:crypto'; import { readFileSync } from 'node:fs'; process.stdout.write(createHash('sha256').update(readFileSync('package-lock.json')).digest('hex'))")"
INSTALLED_HASH=""

if [ -f "$STAMP_FILE" ]; then
  INSTALLED_HASH="$(cat "$STAMP_FILE")"
fi

if [ ! -d node_modules ] || [ ! -f "$STAMP_FILE" ] || [ "$CURRENT_HASH" != "$INSTALLED_HASH" ]; then
  echo "Installing Linux dependencies into the isolated Docker volume..."
  npm install
  mkdir -p node_modules
  printf '%s' "$CURRENT_HASH" > "$STAMP_FILE"
fi

git config --global --add safe.directory /workspace >/dev/null 2>&1 || true

if [ -n "${GIT_AUTHOR_NAME:-}" ]; then
  git config --global user.name "$GIT_AUTHOR_NAME"
fi

if [ -n "${GIT_AUTHOR_EMAIL:-}" ]; then
  git config --global user.email "$GIT_AUTHOR_EMAIL"
fi
