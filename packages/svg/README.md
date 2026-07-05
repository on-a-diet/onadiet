# @onadiet/svg

> The **SVG format adapter** for [onadiet](https://github.com/on-a-diet/onadiet) — put your SVGs on a diet,
> locally. Part of the `@onadiet/*` engine; you normally use the
> [`onadiet`](https://www.npmjs.com/package/onadiet) CLI (`diet icon.svg`), not this package directly.

It implements the [`@onadiet/core`](https://www.npmjs.com/package/@onadiet/core) seams for SVG vector files:

- **`detect`** — is this really an SVG? (structure sniff, not just the extension)
- **`weigh`** — byte size + what's heavy (editor cruft, coordinate precision)
- **`slim`** — optimize via [svgo](https://github.com/svg/svgo), mapping the diet plans to optimization
  aggressiveness (float precision is the quality knob). `cleanse` is genuinely **lossless** — it strips editor
  cruft and leaves the geometry untouched

Output is always **valid SVG** — no rasterization, no uploads, permissive-only (svgo, MIT). Every result is
measured and never larger than the input.

## Exports

| Export         | What it is                                                   |
| -------------- | ------------------------------------------------------------ |
| `svgAdapter`   | `FormatAdapter` — `detect` + `weigh` + `slim` (kind `'svg'`) |
| `looksLikeSvg` | structure-based SVG detection (not extension-based)          |

## License

Apache-2.0.
