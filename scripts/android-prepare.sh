#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GEN_DIR="$ROOT_DIR/src-tauri/gen/android"
APP_GRADLE="$GEN_DIR/app/build.gradle.kts"
APP_TAURI_CONF="$GEN_DIR/app/src/main/assets/tauri.conf.json"
STALE_BUILDSRC_DIR="$GEN_DIR/buildSrc/src/main/java/com/voiceideas/app"

if [ ! -d "$GEN_DIR" ]; then
  echo "Android project not generated yet: $GEN_DIR" >&2
  exit 1
fi

if [ -f "$APP_GRADLE" ]; then
  perl -0pi -e 's/manifestPlaceholders\["usesCleartextTraffic"\] = "false"/manifestPlaceholders["usesCleartextTraffic"] = "true"/g' "$APP_GRADLE"
fi

if [ -f "$APP_TAURI_CONF" ]; then
  perl -0pi -e 's/"useHttpsScheme":false/"useHttpsScheme":true/g' "$APP_TAURI_CONF"
fi

if [ -d "$STALE_BUILDSRC_DIR" ]; then
  rm -rf "$STALE_BUILDSRC_DIR"
fi

echo "Android project prepared."
