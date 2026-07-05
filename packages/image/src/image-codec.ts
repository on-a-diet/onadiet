/**
 * The sharp/libvips multi-format {@link ImageCodec} for standalone images.
 *
 * Unlike the PDF codec (JPEG-only, since that's the one lossy filter valid in a PDF), this emits **JPEG,
 * PNG, WebP, or AVIF** per {@link EncodeParams.format} — the format-switch lever that only makes sense for a
 * standalone file. PNG is lossless (the `quality` knob doesn't apply); JPEG/WebP/AVIF are quality-driven.
 * JPEG has no alpha channel, so an image with transparency is flattened onto white before a JPEG encode.
 */
import { OnadietError } from '@onadiet/core'
import type { EncodeParams, ImageCodec, ImageFormat, RasterImage } from '@onadiet/core'
import sharp from 'sharp'

/**
 * Cap decoded pixels so a small file can't claim huge dimensions and balloon memory (~400 MB worst case).
 * Exported so every sharp call that decodes untrusted input — including the adapter's content estimate —
 * applies the same bound.
 */
export const MAX_INPUT_PIXELS = 100_000_000
const WHITE = '#ffffff'

/**
 * Decode encoded image bytes into a raw raster, preserving the source channel count (incl. alpha). A pure
 * grayscale source is kept 1-channel — sharp otherwise expands it to 3-channel sRGB, tripling the luma data
 * and hurting compression (mirrors the PDF codec).
 */
async function decode(bytes: Uint8Array): Promise<RasterImage> {
  try {
    const meta = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()
    const gray = meta.channels === 1 || meta.space === 'b-w'
    const pipeline = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).raw()
    const { data, info } = await (gray ? pipeline.toColourspace('b-w') : pipeline).toBuffer({
      resolveWithObject: true,
    })
    return {
      width: info.width,
      height: info.height,
      channels: info.channels,
      pixels: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new OnadietError('UNSUPPORTED_INPUT', `Could not decode image: ${message}`)
  }
}

/**
 * Decode to a **3-channel RGB** raster with any alpha flattened onto white — the common representation the
 * quality metric compares (so a JPEG candidate that dropped alpha is scored fairly against the original).
 */
async function decodeRgb(bytes: Uint8Array): Promise<RasterImage> {
  const { data, info } = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
    .flatten({ background: WHITE })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return {
    width: info.width,
    height: info.height,
    channels: info.channels,
    pixels: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
  }
}

/** Encode a raster to `params.format` (default JPEG) under `params` (optional downscale + quality). */
async function encode(image: RasterImage, params: EncodeParams): Promise<Uint8Array> {
  let pipeline = sharp(Buffer.from(image.pixels), {
    raw: { width: image.width, height: image.height, channels: channelsOf(image) },
    limitInputPixels: MAX_INPUT_PIXELS,
  })
  if (params.scale < 1) {
    pipeline = pipeline.resize({ width: Math.max(1, Math.round(image.width * params.scale)) })
  }
  const q = clampQuality(params.quality)
  switch (params.format ?? 'jpeg') {
    case 'jpeg':
      // JPEG has no alpha — composite onto white so transparency doesn't turn black.
      if (image.channels === 2 || image.channels === 4)
        pipeline = pipeline.flatten({ background: WHITE })
      return finish(pipeline.jpeg({ quality: q, mozjpeg: true }))
    case 'webp':
      return finish(pipeline.webp({ quality: q }))
    case 'avif':
      return finish(pipeline.avif({ quality: q }))
    case 'png':
      // PNG is lossless — quality doesn't apply; squeeze with max compression + effort.
      return finish(pipeline.png({ compressionLevel: 9, effort: 10 }))
  }
}

async function finish(pipeline: sharp.Sharp): Promise<Uint8Array> {
  const out = await pipeline.toBuffer()
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength)
}

/** Resample a raster to exact dimensions (align a downscaled candidate to the original for comparison). */
export async function resampleRaster(
  image: RasterImage,
  width: number,
  height: number,
): Promise<RasterImage> {
  const { data, info } = await sharp(Buffer.from(image.pixels), {
    raw: { width: image.width, height: image.height, channels: channelsOf(image) },
    limitInputPixels: MAX_INPUT_PIXELS,
  })
    .resize({ width, height, fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })
  return {
    width: info.width,
    height: info.height,
    channels: info.channels,
    pixels: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
  }
}

/** sharp accepts 1/2/3/4 raw channels; clamp defensively. */
function channelsOf(image: RasterImage): 1 | 2 | 3 | 4 {
  const c = image.channels
  return c === 1 || c === 2 || c === 3 || c === 4 ? c : 3
}

function clampQuality(quality: number): number {
  return Math.min(100, Math.max(1, Math.round(quality)))
}

/** The default extension for an output format. */
export function extensionFor(format: ImageFormat): string {
  return format === 'jpeg' ? 'jpg' : format
}

/**
 * An {@link ImageCodec} that also exposes {@link decodeRgb} — the flattened 3-channel decode the quality
 * metric compares against, so alpha-dropping outputs (JPEG) are scored fairly.
 */
export type MultiCodec = ImageCodec & {
  decodeRgb(bytes: Uint8Array): Promise<RasterImage>
}

/** The multi-format sharp image codec (JPEG/PNG/WebP/AVIF out). */
export const sharpImageCodec: MultiCodec = {
  kind: 'sharp-multi',
  decode,
  decodeRgb,
  encode,
}
