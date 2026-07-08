import { describe, expect, it } from 'vitest'
import { link, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodePorts } from '../src/index'

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'onadiet-test-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('nodePorts.writeFileAtomic', () => {
  it('writes the bytes and leaves no temp file behind', async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, 'out.bin')
      await nodePorts.writeFileAtomic(path, new Uint8Array([1, 2, 3]))
      expect([...(await readFile(path))]).toEqual([1, 2, 3])
      const strays = (await readdir(dir)).filter((n) => n.startsWith('.onadiet-'))
      expect(strays).toHaveLength(0)
    })
  })

  it('rejects (and does not create the target) when the destination dir is missing', async () => {
    await expect(
      nodePorts.writeFileAtomic('/no-such-onadiet-dir-xyz/out.bin', new Uint8Array([1])),
    ).rejects.toBeDefined()
  })
})

describe('nodePorts.sameFile', () => {
  it('is true for the same path and a hardlink, false otherwise', async () => {
    await withTempDir(async (dir) => {
      const a = join(dir, 'a')
      const b = join(dir, 'b')
      await writeFile(a, 'x')
      await writeFile(b, 'y')
      expect(await nodePorts.sameFile(a, a)).toBe(true)
      expect(await nodePorts.sameFile(a, b)).toBe(false)
      expect(await nodePorts.sameFile(a, join(dir, 'missing'))).toBe(false)

      const hard = join(dir, 'hard')
      await link(a, hard) // same inode → the identity guard must treat it as the same file
      expect(await nodePorts.sameFile(a, hard)).toBe(true)
    })
  })
})
