import { OnadietError } from './types'

/** Byte multipliers. Decimal (kb/mb/gb) and binary (kib/mib/gib) both supported. */
const UNITS: Readonly<Record<string, number>> = {
  b: 1,
  kb: 1_000,
  mb: 1_000_000,
  gb: 1_000_000_000,
  tb: 1_000_000_000_000,
  kib: 1_024,
  mib: 1_048_576,
  gib: 1_073_741_824,
}

const SIZE_RE = /^\s*([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]+)?\s*$/

/** Parse a human size like `5mb`, `500kb`, `2.5 MiB`, or a bare byte count into a number of bytes. */
export function parseSize(input: string): number {
  const match = SIZE_RE.exec(input)
  const num = match?.[1]
  if (num === undefined) {
    throw new OnadietError('INVALID_SIZE', `Not a valid size: "${input}"`)
  }
  const rawUnit = match?.[2]
  const factor = UNITS[(rawUnit ?? 'b').toLowerCase()]
  if (factor === undefined) {
    throw new OnadietError('INVALID_SIZE', `Unknown size unit: "${rawUnit ?? ''}"`)
  }
  return Math.round(Number(num) * factor)
}

/** Format a byte count into a compact human string (decimal units), like the CLI report. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new OnadietError('INVALID_SIZE', `Not a valid byte count: ${bytes}`)
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const
  let value = bytes
  let i = 0
  while (value >= 1000 && i < units.length - 1) {
    value /= 1000
    i += 1
  }
  // Rounding can push a value up into the next unit (e.g. 999_999 → "1000 KB"); promote it instead.
  const decimals = i === 0 || value >= 10 ? 0 : 1
  if (i < units.length - 1 && Number(value.toFixed(decimals)) >= 1000) {
    value /= 1000
    i += 1
  }
  const rendered = i === 0 ? String(value) : value.toFixed(value < 10 ? 1 : 0)
  return `${rendered} ${units[i] ?? 'B'}`
}

/** Percentage saved (one decimal). Negative means the output grew. */
export function savedPercent(inputBytes: number, outputBytes: number): number {
  if (!Number.isFinite(inputBytes) || inputBytes <= 0) {
    throw new OnadietError(
      'INVALID_SIZE',
      `inputBytes must be a positive number, got ${inputBytes}`,
    )
  }
  if (!Number.isFinite(outputBytes) || outputBytes < 0) {
    throw new OnadietError(
      'INVALID_SIZE',
      `outputBytes must be a non-negative number, got ${outputBytes}`,
    )
  }
  return Math.round(((inputBytes - outputBytes) / inputBytes) * 1000) / 10
}
