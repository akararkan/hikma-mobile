#!/usr/bin/env bash
# =========================================================
#   Repackage the signed iOS .ipa after a code change.
#
#   The archive step runs the "Bundle React Native code and
#   images" build phase itself, so a JS/TS change needs nothing
#   else — no expo export, no Metro, no pod install.
#
#   CocoaPods only has to run when a NATIVE dependency changed
#   (a new expo-* package, a react-native-* with an ios/ folder).
#   It is skipped by default because it costs a minute and
#   answers "nothing to do" almost every time:
#
#       npm run ipa            after a code change
#       npm run ipa -- --pods  after adding a native dependency
#
#   Signing comes from ios/ExportOptions.plist. First-time setup
#   (Apple ID in Xcode, team id in that plist) is described in
#   the file itself.
# =========================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${IPA_OUT:-$HOME/Desktop/IKA.ipa}"
ARCHIVE="$(mktemp -d)/IKA.xcarchive"
EXPORT_DIR="$(mktemp -d)"

# xcode-select still points at the CommandLineTools on this machine, so every
# xcodebuild invocation has to be told where the real Xcode is.
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

cd "$ROOT/ios"

if [[ ! -f ExportOptions.plist ]]; then
  echo "✗ ios/ExportOptions.plist is missing — it carries your team id." >&2
  exit 1
fi
if grep -q REPLACE_WITH_YOUR_TEAM_ID ExportOptions.plist; then
  echo "✗ Put your Apple team id in ios/ExportOptions.plist first." >&2
  echo "  Xcode ▸ Settings ▸ Accounts, or: security find-identity -v -p codesigning" >&2
  exit 1
fi

if [[ "${1:-}" == "--pods" ]]; then
  echo "▸ pod install"
  pod install
fi

echo "▸ archiving (this is the slow part)"
xcodebuild -quiet \
  -workspace IKA.xcworkspace \
  -scheme IKA \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  archive

echo "▸ exporting signed ipa"
xcodebuild -quiet -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist ExportOptions.plist \
  -exportPath "$EXPORT_DIR" \
  -allowProvisioningUpdates

# Replaced only once the export has actually succeeded, so a failed build
# leaves the previous working ipa where it was rather than deleting it first.
mv "$EXPORT_DIR/IKA.ipa" "$OUT"
rm -rf "$ARCHIVE" "$EXPORT_DIR"

echo "✓ $OUT  ($(du -h "$OUT" | cut -f1))"
