#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GEN_DIR="$ROOT_DIR/src-tauri/gen/android"
APP_GRADLE="$GEN_DIR/app/build.gradle.kts"
APP_TAURI_CONF="$GEN_DIR/app/src/main/assets/tauri.conf.json"
APP_MANIFEST="$GEN_DIR/app/src/main/AndroidManifest.xml"
NETWORK_SECURITY_CONFIG="$GEN_DIR/app/src/main/res/xml/network_security_config.xml"
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

if [ -f "$APP_MANIFEST" ]; then
  perl -0pi -e 's/android:usesCleartextTraffic="\$\{usesCleartextTraffic\}"/android:usesCleartextTraffic="\$\{usesCleartextTraffic\}"\n        android:networkSecurityConfig="\@xml\/network_security_config"/g' "$APP_MANIFEST"
fi

mkdir -p "$(dirname "$NETWORK_SECURITY_CONFIG")"
cat > "$NETWORK_SECURITY_CONFIG" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="true">tauri.localhost</domain>
    <domain includeSubdomains="true">localhost</domain>
    <domain includeSubdomains="true">127.0.0.1</domain>
  </domain-config>
</network-security-config>
EOF

if [ -d "$STALE_BUILDSRC_DIR" ]; then
  rm -rf "$STALE_BUILDSRC_DIR"
fi

echo "Android project prepared."
