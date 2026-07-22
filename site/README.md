# onadiet — public site

The project's public **landing site**. Hand-written, self-contained static
HTML/CSS/JS — **no framework, no build step, no dependencies**. Open `index.html` and it runs.

## It's just a site — isolated from the library

This folder is **not** part of the `@onadiet/*` packages and is deliberately decoupled from the library's
toolchain:

- **No package.json, no build** — static files; nothing compiles, nothing to install.
- **CI skips it** — the workflow `paths-ignore`s `site/**`, so a site-only change never triggers the library's
  build / test / golden-corpus pipeline (and the library's gates never block the site).
- **Scoped linting** — ESLint treats `site/**/*.js` as browser code (its own globals); the library's strict
  TypeScript / pure-core rules do not apply here.

## Files

```
index.html    the landing page (single page; anchor-nav sections, incl. the live #try demo)
styles.css    all styling — dark by default, light via [data-theme="light"]; theme tokens at the top
app.js        theme toggle (persisted), copy-to-clipboard, the weigh-in reveal — vanilla, no deps
demo/         the live on-device demo (the #try section):
                demo.js         Canvas WebP re-encode + real SSIM floor + the no-upload proof gauge
                sample-data.js  the sample photo, inlined as a data URI so it decodes locally (zero
                                requests — keeps the proof gauge honestly at zero for the sample too)
assets/       onadiet-mark.png (the real mascot) + favicon.png
BRIEF.md      the design brief (identity, palette, type, the non-negotiables)
```

## The live demo (`#try`) — real, on-device, safe

The demo compresses a photo **100% in the browser**: it re-encodes to **WebP** (the only format a browser
shrinks efficiently — a PNG re-saved as PNG in a browser _grows_ ~6×, since a web page has no PNG optimizer),
each plan a WebP quality + optional downscale, scores the result with the **same SSIM** the engine uses, and
keeps your original if it can't beat it. Nothing is uploaded — a gauge instruments every `fetch`/`XHR` and they
stay at zero. It's deliberately a **taste** (one image, browser WebP, no AVIF/PDF/folders); **format-preservation
is the library's job** (it keeps a PNG a PNG or a JPEG a JPEG — mozjpeg for JPEG — or switches to WebP/AVIF when
that's smaller) — that's the funnel.

Because it's entirely client-side, there is **nothing server-side to abuse**: every compression runs on the
visitor's own CPU, so scripting it in a loop only burns their machine, not ours — no rate-limiting needed.
Dropped files are still untrusted, so the demo validates type, **caps size (40 MB) and dimensions (4096 px/
side) before any canvas work** (a small file can decode to a huge image and hang the tab), wraps decode/
encode so a bad file never sticks, revokes object URLs, and never writes untrusted text via `innerHTML`.

## Preview locally

```bash
npx serve site      # any static server; then open the printed URL
# — or just —
open site/index.html
```

## Design

The **little-eater mascot** (the real icon) as personality; the **weigh-in / nutrition-label** treatment for
the honest before→after numbers. Ink + pixel-red + warm paper. **Dark is the default**, light is a toggle —
both designed and tested. Every claim is measured (the benchmark table is the real golden-corpus run), the
status badge is truthful (`npm · v0.1.1`, early), and there are no dead links; the only external request is
a privacy-first, cookieless analytics beacon (Cloudflare Web Analytics) — no CDN, no remote fonts/images. Accessible: visible focus, `prefers-reduced-motion`, `aria-hidden` decor.

Sections: hero + weigh-in · **try it — live on-device demo** · measured benchmarks · diet plans · **embed / hot-path** (the engine in your
server) · **the franchise vision** (_one verb, everything smaller_ — files shipped, the rest on the roadmap) ·
why · getting started. Standalone `why` / `docs` pages can graduate out of the anchor sections as the docs
grow (don't build ahead of reality).

## Deploy

Static — serve the `site/` folder from anywhere (GitHub Pages, Netlify, a bucket). No domain yet.
