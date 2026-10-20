#!/bin/sh
# Installs the planny skill where Kuvo scans, and adds the /planny command.
#   installed skill:  ${SKILLS_DIR:-$HOME/.agents/skills}/planny   (Settings > Skills)
#   installed command: ${CLAUDE_COMMANDS_DIR:-$HOME/.claude/commands}/planny.md
# The command is imported under Settings > Commands, not Settings > Skills.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
chmod 700 "$here/scripts"
chmod 700 "$here/scripts"/*.mjs

skills_dir="${SKILLS_DIR:-$HOME/.agents/skills}"
mkdir -p "$skills_dir"
target="$skills_dir/planny"
rm -rf "$target"
ln -s "$here" "$target"

commands_dir="${CLAUDE_COMMANDS_DIR:-$HOME/.claude/commands}"
mkdir -p "$commands_dir"
cp "$here/commands/planny.md" "$commands_dir/planny.md"

echo "Skill:   $target -> $here   (Settings > Skills)"
echo "Command: $commands_dir/planny.md   (Settings > Commands, not Skills)"
echo "Publish: node $here/scripts/publish.mjs plan.html --name \"...\" --duration 90d"
echo "Delete:  node $here/scripts/delete.mjs <plan-id>"
