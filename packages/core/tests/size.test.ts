import { describe, expect, it } from 'vitest'
import { OnadietError, formatBytes, parseSize, savedPercent } from '../src/index'

describe('parseSize', () => {
  it('parses decimal units', () => {
    expect(parseSize('5mb')).toBe(5_000_000)
    expect(parseSize('500kb')).toBe(500_000)
    expect(parseSize('2.5mb')).toBe(2_500_000)
    expect(parseSize('1gb')).toBe(1_000_000_000)
  })

  it('parses binary units', () => {
    expect(parseSize('1kib')).toBe(1024)
    expect(parseSize('1mib')).toBe(1_048_576)
  })

  it('treats a bare number as bytes and ignores case/whitespace', () => {
    expect(parseSize('1024')).toBe(1024)
    expect(parseSize('  5 MB ')).toBe(5_000_000)
  })

  it('throws INVALID_SIZE on garbage or unknown units', () => {
    expect(() => parseSize('abc')).toThrowError(OnadietError)
    expect(() => parseSize('5zb')).toThrowError(/Unknown size unit/)
  })
})

describe('formatBytes', () => {
  it('formats across units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(999)).toBe('999 B')
    expect(formatBytes(1_500_000)).toBe('1.5 MB')
    expect(formatBytes(42_100_000)).toBe('42 MB')
  })

  it('rejects negative / non-finite', () => {
    expect(() => formatBytes(-1)).toThrowError(OnadietError)
    expect(() => formatBytes(Number.NaN)).toThrowError(OnadietError)
  })

  it('promotes a value that rounds up into the next unit', () => {
    expect(formatBytes(999_999)).toBe('1.0 MB')
    expect(formatBytes(999_500)).toBe('1.0 MB')
    expect(formatBytes(999_499)).toBe('999 KB')
  })
})

describe('savedPercent', () => {
  it('computes a rounded percentage', () => {
    expect(savedPercent(100, 25)).toBe(75)
    expect(savedPercent(41_200_000, 4_700_000)).toBe(88.6)
  })

  it('is negative when the output grew', () => {
    expect(savedPercent(100, 150)).toBe(-50)
  })

  it('throws when inputBytes is not positive', () => {
    expect(() => savedPercent(0, 0)).toThrowError(OnadietError)
  })

  it('throws on an invalid outputBytes', () => {
    expect(() => savedPercent(100, Number.NaN)).toThrowError(OnadietError)
    expect(() => savedPercent(100, -50)).toThrowError(OnadietError)
    expect(() => savedPercent(100, Number.POSITIVE_INFINITY)).toThrowError(OnadietError)
  })
})
