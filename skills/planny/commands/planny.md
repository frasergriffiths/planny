# /planny

Publish an HTML plan and get a link back.

1. Choose a template. `template.html` is the project plan; `templates/launch-plan.html`, `templates/research-plan.html` and `templates/decision-plan.html` cover a launch, a study and a decision.
2. Read `reference/unslop.md` and apply it to every visible word. Then write one HTML file. The plan can use HTML, inline SVG, CSS and images embedded as `data:image/...`. Code blocks use the `.code-block` markup with static `.tok-*` spans; the viewer adds the Copy button. Icons are inline SVGs from `reference/icons.md`. No scripts, links, forms, frames, external files or external fonts. Keep the Who, Why, What, When order.
3. Publish it:
   `node <skill-dir>/scripts/publish.mjs plan.html --name "Q4 rollout" --duration 90d` (or `node "$HOME/.agents/skills/planny/scripts/publish.mjs" ...` after ./install.sh)
   The script checks the size and UTF-8, warns about markup the sanitiser will remove, then prints the link, the expiry and the path to the key file. It never prints the key. It posts to `https://use-planny.vercel.app` by default; set `PLANNY_URL` to change it.
4. Give the user the link. Tell them the key is in `~/.planny/<id>.json`, readable only by them.
5. To take it down early: `node <skill-dir>/scripts/delete.mjs <id>` (or `node "$HOME/.agents/skills/planny/scripts/delete.mjs" <id>`). It uses the plan's stored URL origin, so a production plan deletes from production. Never copy the delete key into a chat or a command line.

Limits: 4 MiB per plan, 1 hour to 100 years, name 1 to 120 characters. A wrong or expired link shows a designed 404 or 410 page.
