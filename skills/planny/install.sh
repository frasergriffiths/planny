#!/bin/sh
# Installs the planny skill: makes the scripts executable and adds the /planny command.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
chmod 700 "$here/scripts"
chmod 700 "$here/scripts"/*.ts
target="${CLAUDE_COMMANDS_DIR:-$HOME/.claude/commands}"
mkdir -p "$target"
cp "$here/commands/planny.md" "$target/planny.md"
echo "Installed the planny skill at $here."
echo "Command: $target/planny.md"
echo "Publish: bun $here/scripts/publish.ts plan.html --name \"...\" --duration 90d"
echo "Delete:  bun $here/scripts/delete.ts <plan-id>"
