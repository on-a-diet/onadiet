# onadiet — site design brief

> The design input for the public site.
> This captures the identity; the pages implement it. The look is onadiet's own — never a template, never a
> babystack clone.

## What it is + who it's for

- **What:** a local CLI + library that "puts your files on a diet" — shrinks PDFs, images, SVGs, and folders
  under a size limit, **on your machine, no upload**, safe by default, with an honest before/after receipt.
- **Who:** developers who hit an upload limit or a bloated asset folder and don't want to hand their files to
  a stranger's server — plus servers/agents embedding the engine on a hot path.

## Positioning / voice / feeling

- **Playful but precise.** The diet metaphor is the vocabulary (weigh-in, plans, goal weight, receipt); the
  substance is honest, measured engineering. Wit in the words, rigor in the numbers.
- **Honest above all.** Every number is measured, never estimated; it keeps your original and refuses to fake
  a win. The site must _feel_ trustworthy — receipts and measured tables, not vibes.
- **Must NOT feel like:** an enterprise SaaS, a hand-wavy "AI-powered" pitch, or a generic dev-tool template.

## Identity — the fusion

Two motifs, together:

1. **The little eater (mascot).** The charcoal creature from the icon that _eats red pixel-blocks_ — literally
   consuming the bloat. It's the personality: the mascot leads the hero and chomps a file down (an animated
   pixel-dissolve), and is the favicon. Light + dark variants.
2. **The weigh-in / nutrition label.** The honest, precise treatment: **before → after weigh-in bars**, a
   **nutrition-facts-style receipt** (the real `diet` output), the **five plans as a menu**, and the measured
   benchmark tables. Big **tabular-mono numbers** carry the credibility.

The creature does the eating; the label proves it was honest.

## Palette (named)

- `--ink` charcoal, slightly warm (the creature, headings) · `--red` the vivid pixel-red from the icon (the
  one accent — the bloat being eaten) · `--paper` a warm off-white ground (never pure #fff) · `--ash` a warm
  neutral grey (secondary text) · plus semantic good/over for the honest pass/fail chips (separate from the
  red accent). Dark theme: deep warm charcoal ground, off-white text, the red re-tuned for contrast.

## Type

- **Display/headline:** a characterful heavy grotesque (self-hosted / inlined — no CDN). Big, tight tracking.
- **Data/receipt/terminal:** monospace with `tabular-nums` — the star; the weigh-in numbers and receipts.
- **Body:** a clean, readable sans.
- Avoid the AI-cliché defaults (Inter / Space Grotesk as the "safe" pick; cream+serif+terracotta).

## Non-negotiables (the look is free, these bars are not)

- **Theme-aware** — light **and** dark, both tested; neither an afterthought.
- **Responsive** — no horizontal page scroll; wide blocks (tables, code) scroll in their own container.
- **Accessible** — visible keyboard focus; `prefers-reduced-motion` disables the chomp animation; decorative
  motion is `aria-hidden`.
- **No CDN / external fonts / remote images** — everything self-contained.
- **Logo front and center** — the mascot leads the hero + sits in the header (returns home) + is the favicon.
- **Honest copy** — a truthful **`pre-release`** badge (built & tested through v0.4, **not on npm yet**); every perf
  claim carries **measured numbers + method** (the benchmarks are real: SpaceX 9 MB deck, NASA photo corpus,
  the `test:perf` latency numbers).

## Clichés to avoid

Cream + serif + terracotta; lone neon-on-near-black; purple→blue gradient hero; Inter/Space-Grotesk as the
default; emoji section markers; everything centered; rounded-lg everywhere.

## Pages (scoped to pre-release maturity)

Landing (hero → install-from-source → live `diet` demo/receipt → measured benchmarks → the 5 plans → why-local
→ CTA) · Docs/Usage (commands, plans, targets) · Why onadiet (honest comparison vs upload-sites / Ghostscript,
with measured numbers) · Roadmap (mirror/link) · Release (link GitHub Releases). Header links home + ~5;
footer is the full sitemap (repo · npm _once published, else omit — never a dead link_ · releases · license ·
contributing · security · discussions).
