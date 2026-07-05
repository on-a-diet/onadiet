# @onadiet/pdf

> The **PDF format adapter** for [onadiet](https://github.com/on-a-diet/onadiet) — put your PDFs on a diet,
> locally. Part of the `@onadiet/*` engine; you normally use the [`onadiet`](https://www.npmjs.com/package/onadiet)
> CLI (`diet report.pdf --to 5mb`), not this package directly.

It implements the [`@onadiet/core`](https://www.npmjs.com/package/@onadiet/core) seams for PDFs:

- **`detect`** — is this a PDF? (header scan)
- **`weigh`** — where the bytes are (embedded images vs. everything else)
- **`slim`** — _(v0.1 step 3)_ hit a size target by re-encoding embedded images

The work is done by permissive, best-in-class local tools: **[pdf-lib](https://pdf-lib.js.org/)** (MIT) for
parse/rebuild and **[sharp](https://sharp.pixelplumbing.com/)/mozjpeg** for the pixels. Output is **standard
PDF with JPEG (DCTDecode)** images — the one lossy image filter valid inside a PDF (WebP/AVIF cannot live in
one). No uploads, no copyleft engines bundled.

## What's here (v0.1 step 2)

| Export                          | What it is                                                           |
| ------------------------------- | -------------------------------------------------------------------- |
| `pdfAdapter`                    | `FormatAdapter` — `detect` + `weigh` (kind `'pdf'`)                  |
| `sharpImageCodec`               | `ImageCodec` — decode/encode via sharp/mozjpeg (JPEG out)            |
| `ssimMetric`                    | `QualityMetric` — mean SSIM over 8×8 luma blocks (the quality floor) |
| `findImages` / `imageByteTotal` | low-level pdf-lib image-XObject enumeration                          |

The extract→re-encode→re-embed capability these build on is proven by
`tests/integration/image-replace.probe.test.ts` (a real PDF, measured smaller + still valid).

## License

Apache-2.0.
