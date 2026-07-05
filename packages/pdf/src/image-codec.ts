/**
 * The sharp/mozjpeg-backed {@link ImageCodec} — the pixel engine the size-search's levers pull.
 *
 * v0.1 emits **JPEG (DCTDecode) only** — the one lossy image filter valid inside a PDF (WebP/AVIF can't
 * live in one; see docs/guide/pdf.md). `EncodeParams.recodeToJpeg` is a planning-level signal (which
 * images the adapter routes here), not a codec knob — this codec always produces JPEG.
 */
import { OnadietError } from '@onadiet/core'
import type { EncodeParams, ImageCodec, RasterImage } from '@onadiet/core'
import sharp from 'sharp'

/**
 * Cap on decoded pixels — a decode of untrusted PDF image bytes must not balloon memory (a small file can
 * claim huge dimensions). 100 MP (~10000×10000) is far beyond any real document image while bounding a
 * worst-case raw buffer to ~400 MB. Overridable later if a legitimate need appears.
 */
const MAX_INPUT_PIXELS = 100_000_000

/**
 * Decode encoded image bytes (JPEG/PNG/…) into a raw raster. Wraps sharp failures as a typed error.
 * Grayscale sources are kept 1-channel (sharp otherwise expands them to 3-channel sRGB, which would triple a
 * grayscale scan's data and wreck its compression).
 */
async function decode(bytes: Uint8Array): Promise<RasterImage> {
  try {
    const meta = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()
    const gray = meta.channels === 1 || meta.space === 'b-w'
    const pipeline = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).raw()
    // `data`/`info` types are INFERRED from toBuffer's return — no `sharp.OutputInfo` annotation. sharp
    // 0.34 exposed its types via `declare namespace sharp` (so `sharp.OutputInfo` resolved); 0.35 dropped
    // the namespace for named type exports, which broke that reference. Inference works on both.
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

/** Resample a raster to exact dimensions (used to compare a downscaled candidate against its original). */
export async function resampleRaster(
  image: RasterImage,
  width: number,
  height: number,
): Promise<RasterImage> {
  const out = await sharp(Buffer.from(image.pixels), {
    raw: { width: image.width, height: image.height, channels: channelsOf(image) },
    limitInputPixels: MAX_INPUT_PIXELS,
  })
    .resize({ width, height, fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })
  return {
    width: out.info.width,
    height: out.info.height,
    channels: out.info.channels,
    pixels: new Uint8Array(out.data.buffer, out.data.byteOffset, out.data.byteLength),
  }
}

/** Encode a raster to JPEG under `params` (mozjpeg; optional downscale). */
async function encode(image: RasterImage, params: EncodeParams): Promise<Uint8Array> {
  let pipeline = sharp(Buffer.from(image.pixels), {
    raw: { width: image.width, height: image.height, channels: channelsOf(image) },
    limitInputPixels: MAX_INPUT_PIXELS,
  })
  if (params.scale < 1) {
    const width = Math.max(1, Math.round(image.width * params.scale))
    pipeline = pipeline.resize({ width })
  }
  if (image.channels === 2 || image.channels === 4) {
    // JPEG has no alpha — composite onto white. Covers both gray+alpha (2ch) and RGBA (4ch); missing the
    // 2ch case silently bakes transparency to black.
    pipeline = pipeline.flatten({ background: '#ffffff' })
  }
  if (image.channels === 1 || image.channels === 2) {
    // Keep grayscale 1-channel — sharp otherwise emits a 3-channel sRGB JPEG (3× the data).
    pipeline = pipeline.toColourspace('b-w')
  }
  const out = await pipeline
    .jpeg({ quality: clampQuality(params.quality), mozjpeg: true })
    .toBuffer()
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength)
}

/** sharp accepts 1/2/3/4 raw channels; clamp defensively. */
function channelsOf(image: RasterImage): 1 | 2 | 3 | 4 {
  const c = image.channels
  return c === 1 || c === 2 || c === 3 || c === 4 ? c : 3
}

function clampQuality(quality: number): number {
  return Math.min(100, Math.max(1, Math.round(quality)))
}

/** The default sharp/mozjpeg image codec (JPEG out). */
export const sharpImageCodec: ImageCodec = {
  kind: 'sharp-jpeg',
  decode,
  encode,
}
