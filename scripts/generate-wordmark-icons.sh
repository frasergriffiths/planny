#!/bin/sh
# Manual macOS asset generator: renders public/icon-wordmark.svg into the large
# committed PNGs via sips. CI does not run this; rerun it locally after editing
# the wordmark SVG, then commit the regenerated PNGs.
set -eu
cd "$(dirname "$0")/.."

sips -s format png public/icon-wordmark.svg --out public/icon-512.png >/dev/null
sips -z 192 192 public/icon-512.png --out public/icon-192.png >/dev/null
sips -z 180 180 public/icon-512.png --out public/apple-touch-icon.png >/dev/null
echo 'wrote public/icon-512.png, public/icon-192.png, public/apple-touch-icon.png'
