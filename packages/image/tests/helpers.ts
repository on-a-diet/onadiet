/** Deterministic synthetic image fixtures (no disk, no randomness) for the image-adapter tests. */
import sharp from 'sharp'

function u8(b: Buffer): Uint8Array {
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
}

/** A raw raster: a smooth gradient (compressible) or high-frequency noise (adversarial for compression). */
function rawRaster(
  width: number,
  height: number,
  opts: { alpha?: boolean; noise?: boolean },
): { buf: Buffer; channels: 3 | 4 } {
  const channels = opts.alpha ? 4 : 3
  const buf = Buffer.alloc(width * height * channels)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels
      if (opts.noise) {
        // High-frequency, high-entropy on ALL channels (a deterministic per-pixel hash), so it genuinely
        // resists compression and reads as "photo-like" — not the smooth ramps a linear fill would give.
        const h =
          (x * 374761393 + y * 668265263) ^ ((x * 2246822519) >>> 5) ^ ((y * 3266489917) >>> 3)
        buf[i] = h & 255
        buf[i + 1] = (h >>> 8) & 255
        buf[i + 2] = (h >>> 16) & 255
      } else {
        buf[i] = Math.round((x / (width - 1)) * 255)
        buf[i + 1] = Math.round((y / (height - 1)) * 255)
        buf[i + 2] = Math.round(((x + y) / (width + height - 2)) * 255)
      }
      // Real alpha gradient (0..255 across x) for the transparency fixtures.
      if (opts.alpha) buf[i + 3] = Math.round((x / (width - 1)) * 255)
    }
  }
  return { buf, channels }
}

function pipe(
  width: number,
  height: number,
  opts: { alpha?: boolean; noise?: boolean },
): sharp.Sharp {
  const { buf, channels } = rawRaster(width, height, opts)
  return sharp(buf, { raw: { width, height, channels } })
}

/** A smooth-gradient PNG — compressible; a lossy re-encode holds a high SSIM. */
export async function gradientPng(width = 320, height = 320): Promise<Uint8Array> {
  return u8(await pipe(width, height, {}).png().toBuffer())
}

/** A gradient PNG with **real** (partial) transparency across x. */
export async function transparentPng(width = 320, height = 320): Promise<Uint8Array> {
  return u8(await pipe(width, height, { alpha: true }).png().toBuffer())
}

/** A high-frequency noise PNG — adversarial: hard to compress, useful for keep-original / infeasible. */
export async function noisePng(width = 320, height = 320): Promise<Uint8Array> {
  return u8(await pipe(width, height, { noise: true }).png().toBuffer())
}

/** A near-solid, few-color PNG — genuinely low-entropy "flat/graphic" content (two color blocks). */
export async function flatPng(width = 256, height = 256): Promise<Uint8Array> {
  const buf = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3
      const left = x < width / 2
      buf[i] = left ? 240 : 30
      buf[i + 1] = left ? 240 : 30
      buf[i + 2] = left ? 240 : 30
    }
  }
  return u8(
    await sharp(buf, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer(),
  )
}

/** A smooth-gradient JPEG — a compressible JPEG input. */
export async function gradientJpeg(width = 320, height = 320, quality = 92): Promise<Uint8Array> {
  return u8(await pipe(width, height, {}).jpeg({ quality }).toBuffer())
}

/** A smooth-gradient WebP input. */
export async function gradientWebp(width = 320, height = 320, quality = 90): Promise<Uint8Array> {
  return u8(await pipe(width, height, {}).webp({ quality }).toBuffer())
}

/**
 * A **low-quality noise WebP** — an already-lossy, incompressible input. Re-encoding it at any higher ladder
 * quality only inflates it, and downscaling noise fails a strict floor, so nothing beats the original: the
 * deterministic "keep the original" fixture.
 */
export async function noiseWebp(width = 200, height = 200, quality = 45): Promise<Uint8Array> {
  return u8(await pipe(width, height, { noise: true }).webp({ quality }).toBuffer())
}

/** Re-decode encoded bytes to inspect the actual output (format, dims, alpha). */
export async function inspect(
  bytes: Uint8Array,
): Promise<{ format: string; width: number; height: number; hasAlpha: boolean }> {
  const m = await sharp(Buffer.from(bytes)).metadata()
  return {
    format: m.format ?? 'unknown',
    width: m.width ?? 0,
    height: m.height ?? 0,
    hasAlpha: m.hasAlpha === true,
  }
}

/** The min..max of the alpha channel in `bytes` (255..255 = opaque; a range = real transparency). */
export async function alphaRange(bytes: Uint8Array): Promise<{ min: number; max: number }> {
  const { data, info } = await sharp(Buffer.from(bytes))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  let min = 255
  let max = 0
  for (let i = 3; i < data.length; i += info.channels) {
    const a = data[i]!
    if (a < min) min = a
    if (a > max) max = a
  }
  return { min, max }
}
