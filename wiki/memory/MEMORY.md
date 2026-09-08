# Project Memory

One durable fact per bullet — decisions, preferences, constraints, gotchas.
Newest at the bottom. Curate in place: update what changed, delete what is
wrong, merge duplicates, flag contradictions with ⚠️. Use ⛔ for hard
"never do this" rules. When this file passes ~200 lines, consolidate detail
into topic files in this folder and keep a one-line pointer here.
Detail pages: `<topic>.md` next to this file. Journal: `log.md` (append-only).
Never store secrets, API keys, or tokens here.

## Facts
- Task: Run this app. — Outcome: The app is already running on port 3000. **Status:** - ✅ Static frontend serving at `http://localhost:3000/` (returns 200, serves `index.html`, `app.js`, `admin.js`, `styles.css`) - ✅ Process: `node serve -l 3000 /home/user` (PID 396) - ⚠️ API endpoints under `/api/v1/*` exist as Vercel serverless functions but aren't executed by the local static server — they return 404 in preview. They're only invoked when deployed to Vercel (the `vercel.json` declares them as functions). The dashboard HTML loads the navigation, views, and admin scripts from `app.js` / `admin.js`, but any feature that calls `/api/v1/health`, `/api/v1/dashboard`, `/api/v1/brain/*`, etc. will fail in the local preview. For … #run-summary (fullstack-builder, 2026-09-08) <!-- productos-run:p8mac1ac0rzbepp0elp73ufb -->
