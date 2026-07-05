# @onadiet/image

> The **image format adapter** for [onadiet](https://github.com/on-a-diet/onadiet) — put your images on a diet,
> locally. Part of the `@onadiet/*` engine; you normally use the
> [`onadiet`](https://www.npmjs.com/package/onadiet) CLI (`diet photo.jpg --to 500kb`), not this package
> directly.

It implements the [`@onadiet/core`](https://www.npmjs.com/package/@onadiet/core) seams for standalone raster
images (JPEG / PNG / WebP / AVIF):

- **`detect`** — is this a raster image? (magic-byte sniff, not the extension)
- **`weigh`** — dimensions, format, and a photo-vs-flat content estimate
- **`slim`** — hit a size target (or a plan) by re-encoding + downscaling, held to a measured **SSIM quality
  floor**, with an optional **format switch** (`--format auto` re-encodes to the smallest floor-holding format
  — WebP/AVIF)

The pixels are done by **[sharp](https://sharp.pixelplumbing.com/)/libvips** (permissive). Every result is
**measured, never estimated** — the engine keeps the original if it can't beat it, never writes a larger file,
and holds the plan's perceptual floor. No uploads, no copyleft engines bundled.

## Hot-path notes

`slim` is a pure `(bytes, request) → SlimResult` call with no cross-call state, so it's safe to call from many
concurrent requests. Multi-format searches (`--format auto` / `keto` / `crash`) run their candidate formats
concurrently; `fast: true` skips the ladder search for a ~9× lower per-call latency. To keep a server's event
loop free, offload a slim to a worker thread —
[`examples/worker-offload`](https://github.com/on-a-diet/onadiet/tree/main/examples/worker-offload).

## Exports

| Export             | What it is                                                     |
| ------------------ | -------------------------------------------------------------- |
| `imageAdapter`     | `FormatAdapter` — `detect` + `weigh` + `slim` (kind `'image'`) |
| `sniffImageFormat` | magic-byte format detection (`jpeg` / `png` / `webp` / `avif`) |

## License

Apache-2.0.
