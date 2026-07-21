<div align="center">

# onadiet

**Put your files on a diet.**

_Shrink PDFs, images, and folders under a size limit — locally, on your machine, with no uploads. Safe by
default, and it tells you exactly what it did._

</div>

> [!NOTE]
> **Pre-release: the engine works; npm publish is next.** `diet` slims PDFs, images, SVGs, and folders
> end-to-end today (hit a target size, hold a quality floor, honest receipts) — proven against real-file
> golden corpora. It's **not on npm yet**, so `npm i -g onadiet` /
> `brew install onadiet` don't work until the publish milestone — build from
> [the repo](https://github.com/on-a-diet/onadiet) for now.

## Install

```bash
brew install onadiet        # macOS — installs the `diet` command
npm i -g onadiet            # global; then just `diet …`
npx onadiet report.pdf      # zero-install, one-off
```

The command is **`diet`** (with `onadiet` as an alias).

## Use (planned)

```bash
diet report.pdf --to 5mb            # hit a "goal weight" (--to / --under / --goal)
diet weigh report.pdf               # what does it weigh, what's heavy? (no writes)
diet plan  report.pdf --to 5mb      # dry-run: what it WOULD do
diet check ./public --max 25mb      # CI weigh-in: pass/fail a budget, honest exit codes
diet checkup                        # which engines/codecs are available
```

Quality is a **diet plan**, not a raw flag: `--plan cleanse | balanced | lowcarb | keto | crash`
(lossless → tiny). Everything speaks `--json` for scripts and agents. Safe by default: never overwrites,
skips anything it would make _bigger_, writes atomically, refuses to silently break a signed PDF.

Full walkthrough: **[usage docs](https://github.com/on-a-diet/onadiet/blob/main/docs/guide/getting-started.md)**. This
CLI is a thin shell over the engine in [`@onadiet/core`](https://www.npmjs.com/package/@onadiet/core).

## License

[Apache-2.0](./LICENSE) © Sharvil Kadam.
