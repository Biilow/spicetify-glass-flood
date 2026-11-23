#!/bin/bash
# Installs Flood into Spicetify without Marketplace and applies it.
# Run it again after editing the theme.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SPICETIFY="$(command -v spicetify || echo "$HOME/.spicetify/spicetify")"
T="$("$SPICETIFY" path userdata)/Themes/Flood"
mkdir -p "$T"
install -m 0644 "$HERE/user.css" "$HERE/color.ini" "$HERE/theme.js" "$T/"
"$SPICETIFY" config current_theme Flood color_scheme Flood inject_css 1 replace_colors 1 inject_theme_js 1 >/dev/null
echo "Flood copied to $T"
if [ "${1:-}" != "--no-apply" ]; then "$SPICETIFY" apply; fi
