# /planny

Publish an HTML plan and get a link back.

1. Write one HTML file. The plan can use HTML, inline SVG, CSS and images embedded as `data:image/...`. No scripts, links, forms, frames, external files or external fonts.
2. Publish it:
   `bun "$HOME/.agents/skills/planny/scripts/publish.ts" plan.html --name "Q4 rollout" --duration 90d`
   The script checks the size and UTF-8, warns about markup the sanitiser will remove, then prints the link, the expiry and the path to the key file. It never prints the key. It posts to `https://planny-pink.vercel.app` by default.
3. Give the user the link. Tell them the key is in `~/.planny/<id>.json`, readable only by them.
4. To take it down early: `bun "$HOME/.agents/skills/planny/scripts/delete.ts" <id>`. It uses the plan's stored URL origin, so a production plan deletes from production. Never copy the delete key into a chat or a command line.

Limits: 4 MiB per plan, 1 hour to 100 years, name 1 to 120 characters. A wrong or expired link shows a designed 404 or 410 page.
