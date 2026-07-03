import { describe, expect, it } from 'vitest'
import { OnadietError } from '../src/index'

describe('OnadietError', () => {
  it('carries a typed code and is a real Error', () => {
    const err = new OnadietError('SIGNED_PDF', 'digital signature detected')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('OnadietError')
    expect(err.code).toBe('SIGNED_PDF')
    expect(err.message).toContain('signature')
  })
})
