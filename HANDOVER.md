# Eight Limb Entertainment — Handover

Last touched: 2026-05-16. Branch in flight: `refactor/shared-css-dark-mode-perf` (PR #10 against `staging`).

---

## TL;DR — status right now

- **Design-system refactor is mostly done** but **not yet committed/pushed** since the last `index.html` edit. Local working copy is ahead of the PR.
- **One event page (Barratts) is the showcase** for the new per-event poster-treatment layout. The other 20 events still use the old layout — waiting on Barratts approval before rolling out.
- **Live blocker:** Mapbox map shows the wrong location for The Black Prince (we used Google iframe viewport coords; need to geocode the venue name properly). Geocoding script written but not yet run.
- **In-flight requests from user** (not yet implemented):
  1. Replace Facebook + ticket icons with SVGs.
  2. Possibly switch from Mapbox → Google Maps API (open question, leaning Mapbox).

---

## Where the work is

- **Repo**: `EightLimbEntertainment/website` (GitHub)
- **Deploy**: Cloudflare Pages, auto-builds from GitHub. Production = `eightlimbentertainment.com`. Preview deploys at `{branch-hash}.eightlimbentertainment.pages.dev` per PR.
- **Open PR**: <https://github.com/EightLimbEntertainment/website/pull/10> — *significantly out of date*; many later commits live only in the working copy.
- **Local working copy**: `/Users/james.smith/Documents/GitHub/EightLimbEntertainment/Website`
- **Local server (currently running)**: `python3 -m http.server 8000` on `localhost:8000`. Restart: `python3 -m http.server 8000 &` from repo root.

---

## Architecture

### Stylesheet stack

- `index/shared.css` — design tokens (surface ramp 1→6, type scale, spacing, motion, shadows), header/footer/social/mailchimp/wave shared rules. Loaded on every page.
- `index/styles.css` — homepage-only. Event/vinyl cards, divider wave, footer override.
- `events/events-assets/events.css` — event-detail-only. Hero, details, map, poster-treatment block. **Big file** (~800 lines) — recent v3 poster-treatment + event-hero blocks are at the bottom.
- `vinyls/vinyl-assets/vinyl.css` — vinyl-detail-only. Two-column release info, hero image filter.

### Per-event poster theming pipeline

Three scripts in `scripts/`, each idempotent and run in this order:

1. **`extract-poster-palettes.mjs`** — reads each poster from `index/pictures/posters/`, runs node-vibrant via sharp (WebP → PNG transcoded for Jimp), picks `--poster-primary` (background) using a `population × saturation² × darkness-bonus` score, picks `--poster-secondary` (text, lightened to AA-large contrast 3.0) and `--poster-text` (body, AA contrast 4.5). Also picks a Google Font display face via a vibe heuristic (HSL-saturation + warm/cool hue → Bowlby One / Anton / Abril Fatface / Special Elite / Cormorant Garamond / Bebas Neue). Writes `index/pictures/posters/palettes.json`.

2. **`inject-poster-palettes.mjs`** — for each event HTML, finds the hero poster, looks up palette, injects:
   - `<link id="poster-font" href="https://fonts.googleapis.com/css2?family={picked-font}…">`
   - `<style id="poster-palette">:root { --poster-primary, --poster-secondary, --poster-text, --poster-font-display }</style>`
   - `class="poster-treatment"` on `<body>`

3. **`inject-mapbox-maps.mjs`** — replaces the Google Maps iframe (or any existing `.map-container` block) with a Mapbox static image. Uses the event's `--poster-primary` for the marker pin colour. Wraps in `<a>` that opens Google Maps for navigation. Token currently inlined; should read `MAPBOX_TOKEN` env var if set.

4. **`geocode-venues.mjs`** — NEW (just written). Reads venue names from each event's `<p class="event-venue">`, hits Mapbox geocoding API, writes `events/venues.json`. **Not yet wired into `inject-mapbox-maps.mjs`** — that's the next step to fix the wrong-location problem.

### Asset generation

- `scripts/generate-og-image.mjs` — builds `index/pictures/og-image.png` (1200×630) from logo + latest event poster.

### GitHub Actions

- `.github/workflows/main.yml` — old gallery file-list generator (untouched).
- `.github/workflows/update-xml.yml` — sitemap updater (untouched).
- `.github/workflows/og-image.yml` — runs `generate-og-image.mjs` on push to `index.html` / posters.
- `.github/workflows/poster-palettes.yml` — runs extract + inject palettes on poster/script changes.

*Not yet:* a workflow for mapbox injection. Add `node scripts/inject-mapbox-maps.mjs` to the palette workflow.

---

## Decisions locked in

| Topic | Choice | Reasoning |
|---|---|---|
| Accent colour | Rust `#a83b2b` | User rejected pink/magenta in design-system iteration |
| Light-mode panels | White `#ffffff` (original) | Design-system pure-white per `colors_and_type.css` |
| Dark-mode panels | Soft dark `#0a0a0c` → `#1a1a24` ramp | Per design system |
| Events band on homepage | Always `--surface-6` dark (both modes) | Brand-character per design system |
| Per-event poster bg | `--poster-primary` from Vibrant.js (scored by pop × sat² × darkness) | User wants brand colour; darkness bonus ensures readable text |
| Per-event text | `--poster-text` (LightMuted/Vibrant lightened to AA 4.5) | User wants poster's secondary; lifted for legibility |
| Display font per event | Auto-picked from 6 (Bowlby/Anton/Abril/Special Elite/Cormorant/Bebas) via HSL heuristic | User said vibe-based, not hand-pick |
| Map | Mapbox static dark-v11 with per-event marker pin | User asked about Google; demo'd Mapbox; user offered token |
| Newsletter form | Centred pill input, ghost-pill button absolute off the right edge | Per design system kit |
| Logo | Dark variant `ELE_Logo_Dark.webp` swapped via CSS `content:` on `.poster-treatment` and `prefers-color-scheme: dark` | Already wired |

---

## Open issues / blockers (priority order)

### 1. **Wrong map location** (live, user-facing)

Current Mapbox coords (e.g. Barratts `52.24019, -0.89103`) come from the Google iframe's *viewport center*, which is offset from the actual venue pin. Fix:

1. Run `node scripts/geocode-venues.mjs` once geocoder regex is correct (just updated to read from `<p class="event-venue">` instead of the removed `!2s` Google tag).
2. Update `inject-mapbox-maps.mjs` to read `events/venues.json` instead of parsing coords from the iframe.
3. Re-run injection.

User also raised: *"Or maybe we can just switch to Google Maps API"* — open. My recommendation: try Mapbox geocoding first (should know "The Black Prince Northampton"); if results are bad, Google Places is more thorough for small UK pubs but requires a Google Cloud billing account.

### 2. **Map isn't interactive** (user complaint)

Currently a static `<img>` (clickable → opens Google Maps in new tab). User wants to pan/zoom inline.

Switch to Mapbox GL JS embed. Trade-off: ~200KB of JS per page. Alternative: keep static, add a "View larger map" button. **Need decision.**

### 3. **Replace Facebook + ticket icons with SVGs** (just requested, not started)

Currently `index/pictures/icons/facebook.webp` + `ticket_icon.webp`. The design-system bundle has these as raster. To swap to SVG:

- Source SVGs: Lucide / Heroicons / Simple Icons (for Facebook). For tickets there's no standard brand mark — pick a tasteful inline SVG.
- Replace `<img src=".../facebook.webp">` with inline `<svg>` so it picks up `currentColor`.
- Update events.css `.facebook-event` styling: drop `img height: 60px`, set `svg { width: 24px; height: 24px; }` or similar.

Same treatment on vinyl pages for `shopping_icon.svg` (already SVG, just verify usage).

### 4. **Roll out new layout to other 20 event pages** (waiting on Barratts approval)

Once user OKs the Barratts page (`events/4October24-TheBarratts.html`), write a Python script that applies the same transform to the other 20:

- Find `<section class="event-container">` … `</section>` (old hero)
- Find `<svg class="top-header-wave">…</svg>` (old wave between hero and details)
- Find `<section>` … `</section>` containing `<div class="event-details-container">` (old details)
- Replace all three with the new `<section class="event-hero"><div class="event-hero-grid">…` markup
- Preserve venue/date/title/description/guests/facebook+ticket links
- Reorder: eyebrow → title → description → special guests → meta → action icons

Script template: see how Barratts was done in the chat history with the `python3 - <<'PY'` block.

### 5. **Mapbox token URL allowlist** (config only, not code)

Token: `(see Mapbox dashboard; pass to scripts via MAPBOX_TOKEN env var)`

Allowlist (in Mapbox dashboard → token edit) must include:

- `eightlimbentertainment.com` — production (covers subdomains too via cascade)
- `eightlimbentertainment.pages.dev` — Cloudflare Pages previews
- `localhost` — local dev (works for Python http.server on `localhost:8000`)

**Live Server in VS Code defaults to `127.0.0.1`** which Mapbox blocks (IPs not allowed). Either switch Live Server's host setting to `localhost`, or use the Python server we have running.

### 6. **PR #10 way out of date**

Last commit on the branch is from before the design-system implementation, OG image regeneration, palette extraction, poster-treatment, event-hero restructure, and Mapbox swap. To bring it up to date:

```bash
cd /Users/james.smith/Documents/GitHub/EightLimbEntertainment/Website
git status        # check what's modified
git add -A
git commit -m "Implement eight-limb-entertainment-design-system + poster treatment + Mapbox maps"
git push origin refactor/shared-css-dark-mode-perf
```

Then bump the PR description on GitHub.

### 7. **Gallery JS 404s** (not blocking)

`events/galleries/*/file-list.json` 404s in console. The gallery feature is dormant; the path generator workflow is `main.yml` but galleries don't exist for each event. Either populate galleries or hide the gallery div on pages without one. Low priority.

---

## How to preview locally

```bash
cd /Users/james.smith/Documents/GitHub/EightLimbEntertainment/Website
python3 -m http.server 8000
# then open http://localhost:8000
```

**Hard-refresh after CSS/JS changes** (Cmd-Shift-R). Python's server doesn't send cache-busting headers — the browser keeps stale CSS.

To preview the new poster-treatment showcase:

```
http://localhost:8000/events/4October24-TheBarratts.html
```

(Other 20 event pages still use the old layout until rolled out.)

---

## Re-running the per-event pipeline

After adding a new poster or changing a script:

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"   # if node isn't found

node scripts/extract-poster-palettes.mjs   # → palettes.json
node scripts/inject-poster-palettes.mjs    # → patches each event HTML
node scripts/geocode-venues.mjs            # → venues.json (once fixed)
node scripts/inject-mapbox-maps.mjs        # → updates map blocks per event
```

The GitHub Action `poster-palettes.yml` runs the first two on push. Mapbox injection isn't in CI yet — add it.

---

## File map

```
Website/
├── index.html                          ← homepage
├── 404.html
├── HANDOVER.md                         ← this file
├── README.md
├── favicon.ico
├── CNAME, robots.txt, sitemap.xml
│
├── index/
│   ├── shared.css                      ← tokens + chrome (all pages)
│   ├── styles.css                      ← homepage only
│   ├── pictures/
│   │   ├── posters/                    ← gig posters (.webp)
│   │   │   └── palettes.json           ← per-poster extracted palette
│   │   ├── vinyl/                      ← sleeves
│   │   ├── items/                      ← merch
│   │   ├── icons/                      ← social/ticket/chevron raster + 1 SVG
│   │   ├── favicon/
│   │   ├── svg/                        ← layered-waves (now inline in pages, file kept as fallback)
│   │   └── og-image.png                ← generated, 1200×630
│   └── js/                             ← horizontalScroll, hoverEffect, countdownTimer, emailValidation, longTrackList
│
├── events/
│   ├── *.html                          ← 21 event detail pages
│   ├── event-template.html             ← template (don't edit)
│   ├── venues.json                     ← geocoded coords (PENDING)
│   └── events-assets/
│       ├── events.css                  ← event-detail styles (poster-treatment + event-hero blocks at bottom)
│       └── js/                         ← gallery, eventStatus
│
├── vinyls/
│   ├── *.html                          ← 12 vinyl pages
│   └── vinyl-assets/
│       └── vinyl.css
│
├── scripts/
│   ├── extract-poster-palettes.mjs
│   ├── inject-poster-palettes.mjs
│   ├── inject-mapbox-maps.mjs
│   ├── geocode-venues.mjs              ← NEW; regex just fixed to read from <p class="event-venue">
│   └── generate-og-image.mjs
│
└── .github/workflows/
    ├── main.yml                        ← gallery file-list
    ├── update-xml.yml                  ← sitemap
    ├── og-image.yml                    ← OG image
    └── poster-palettes.yml             ← palette extract + inject
```

---

## Design system reference

Original bundle (not in this repo) at `/tmp/ele-design/eight-limb-entertainment-design-system/`. Key files:

- `README.md` — content + visual foundations, iconography rules
- `colors_and_type.css` — token specifications mirrored into our `shared.css`
- `preview/poster-treatment.html` — the cream-paper poster card design that inspired the event-hero layout
- `ui_kits/website/kit.css` — kit-level design intent (event-card, vinyl-card, footer, header)
- `chats/chat1.md` — full back-and-forth with the design assistant (read first for intent)

**Key trade-offs the design-system iteration landed on:**

- Inter (UI) + Cormorant Garamond (display) as the base type system; Bowlby/Anton/Abril/Special Elite/Bebas join per-event via the vibe heuristic.
- Rust `#a83b2b` accent (no magenta, no gradient).
- Surface-1 to surface-6 monochrome ramp; events-band always dark; poster-treatment overrides on event detail pages.
- Inline `<svg>` waves with `fill="var(--surface-N)"` — auto-retheme; replaced the file-based wave imgs.

---

## Mapbox token notes

Token is a `pk.*` public token, safe to commit (designed for client-side exposure with URL restrictions). Live Server's `127.0.0.1` doesn't match a `localhost` allowlist entry — Mapbox treats them as different hostnames and rejects IPs in restrictions.

**Recommended Mapbox approach** for this site: single token with allowlist = `eightlimbentertainment.com`, `eightlimbentertainment.pages.dev`, `localhost`. Two-token (production + dev unrestricted) is also valid but unnecessary for a low-traffic static site.

---

## Things explicitly NOT done (intentional)

- **No JS framework**. Plain HTML + CSS + a few `defer`'d vanilla scripts. Don't introduce React/Vue.
- **No build step for the live site**. Scripts are run pre-commit / in CI; static HTML/CSS is served as-is. Avoid bundlers.
- **No `_headers` file** for Cloudflare cache control. User said free plan, not worth the polish yet.
- **Old `index/pictures/svg/layered-waves-*.svg`** files left in place but unused — the waves are inline SVG in each HTML now. Keep the files as fallback.

---

## What to do next (in this order)

1. **Fix map location** — finish wiring `geocode-venues.mjs` (regex just updated; needs to be run + injector updated to read `venues.json`). Or decide to swap to Google Maps API (needs billing setup).
2. **Decide on interactive map** — switch to Mapbox GL JS (heavier) or keep static + click-to-open?
3. **Get user approval on Barratts** layout, then write the migration script for the other 20 events.
4. **Swap Facebook + ticket icons to inline SVG**.
5. **Commit + push** everything to update PR #10.
6. **Verify Cloudflare Pages preview** before merging to `staging` / `main`.

---

## Tooling notes for the next agent

- **Playwright MCP** is configured but the session in flight saw it disconnect. To re-enable: VS Code → reload window. Configured at user scope via `claude mcp add -s user playwright -- npx -y @playwright/mcp@latest`.
- **Node version**: `v22.22.2` via nvm. Path: `$HOME/.nvm/versions/node/v22.22.2/bin`. If `node: command not found` in a fresh shell, source `~/.nvm/nvm.sh` or export the PATH manually.
- **Cwd matters**: scripts assume `cwd = repo root`. They use `dirname(fileURLToPath(import.meta.url))` then `..`, so they're robust to cwd, but the local Python server must be launched from repo root.
- **Browser cache**: Python's http.server doesn't send cache-busting headers. Hard-refresh after every CSS change or you'll be debugging stale styles.
