/**
 * `@onadiet/image` — the standalone-image {@link FormatAdapter}.
 *
 * Slims JPEG/PNG/WebP/AVIF files to a byte target or a named plan, reusing the pure `@onadiet/core`
 * SizeSearch + SSIM metric, with an opt-in format-switch lever. All I/O stays in the caller (the CLI) —
 * this adapter only reads and returns bytes.
 */
export { imageAdapter, sniffImageFormat } from './adapter'
export { sharpImageCodec, resampleRaster, extensionFor, type MultiCodec } from './image-codec'
export { buildFormatLevers, type ImageFormatLever } from './levers'

export const IMAGE_ADAPTER_KIND = 'image' as const
