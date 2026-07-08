import { describe, expect, it } from 'vitest'
import { runFolder, type DecideFile, type FileDecision, type FolderOptions } from '../src/folder'
import type { CliPorts, DirEntry } from '../src/ports'

/**
 * Direct unit tests for the folder orchestrator (`runFolder`) — its safety + degradation branches (symlink /
 * special-file skipping, unreadable file/dir, write failure, a throwing decide, output collisions,
 * deterministic order, dry-run) can't be reached through the in-memory-tree fake in index.test.ts, so they
 * get a bespoke ports fake here that models symlinks, special files, and injected I/O errors.
 */

type Kind = 'file' | 'dir' | 'symlink' | 'special'
const entry = (name: string, kind: Kind): DirEntry => ({
  name,
  isDirectory: kind === 'dir',
  isSymbolicLink: kind === 'symlink',
  isFile: kind === 'file',
})
const bytes = (s: string): Uint8Array => new TextEncoder().encode(s)

interface Config {
  /** Absolute dir path → its entries. */
  readonly children: Readonly<Record<string, readonly DirEntry[]>>
  /** Absolute file path → contents. */
  readonly contents?: Readonly<Record<string, Uint8Array>>
  readonly readFail?: readonly string[]
  readonly writeFail?: readonly string[]
  readonly readDirFail?: readonly string[]
  /** Force staging to disk to fail, exercising the in-memory fallback in planFile. */
  readonly stageFail?: boolean
}

function makePorts(cfg: Config): CliPorts & {
  readonly written: Map<string, Uint8Array>
  readonly staged: Map<string, Uint8Array>
} {
  const written = new Map<string, Uint8Array>()
  const staged = new Map<string, Uint8Array>() // tempPath → bytes, mirrors on-disk staged slim outputs
  let tempSeq = 0
  return {
    written,
    staged,
    readFile: async (path) => {
      if (cfg.readFail?.includes(path)) throw new Error('EACCES')
      const found = cfg.contents?.[path]
      if (found === undefined) throw new Error(`ENOENT: ${path}`)
      return found
    },
    writeFileAtomic: async (path, data) => {
      if (cfg.writeFail?.includes(path)) throw new Error('ENOSPC')
      written.set(path, data)
    },
    sameFile: async () => false,
    isDirectory: async () => true,
    size: async (path) => cfg.contents?.[path]?.length ?? 0,
    isSymlink: async () => false,
    readDir: async (path) => {
      if (cfg.readDirFail?.includes(path)) throw new Error('EACCES')
      return [...(cfg.children[path] ?? [])]
    },
    mkdirp: async () => {},
    stageTemp: async (dir, data) => {
      if (cfg.stageFail) throw new Error('ENOSPC') // drive the in-memory fallback
      const p = `${dir}/.stage-${tempSeq++}.tmp`
      staged.set(p, data)
      return p
    },
    commitStaged: async (tempPath, dest) => {
      if (cfg.writeFail?.includes(dest)) throw new Error('ENOSPC') // a rename can fail like a write
      const b = staged.get(tempPath)
      if (b === undefined) throw new Error(`no staged temp: ${tempPath}`)
      staged.delete(tempPath)
      written.set(dest, b)
    },
    removeTemp: async (tempPath) => {
      staged.delete(tempPath)
    },
  }
}

const opts = (over: Partial<FolderOptions> = {}): FolderOptions => ({
  inputDir: '/in',
  outputDir: '/out',
  copyUnknown: true,
  ...over,
})

/** Decide that slims every file to a fixed small payload (optionally switching extension). */
const slimTo = (out: string, newExt?: string): DecideFile => {
  const decision: FileDecision =
    newExt !== undefined
      ? { action: 'slimmed', output: bytes(out), newExt, plan: 'keto', method: 'test' }
      : { action: 'slimmed', output: bytes(out), plan: 'keto', method: 'test' }
  return async () => decision
}

describe('runFolder — walk safety', () => {
  it('skips symlinks — never walks or emits them', async () => {
    const ports = makePorts({
      children: { '/in': [entry('a.png', 'file'), entry('link.png', 'symlink')] },
      contents: { '/in/a.png': bytes('aaaa') },
    })
    const m = await runFolder(ports, opts(), slimTo('x'))
    expect(m.files.map((f) => f.path)).toEqual(['a.png']) // link.png absent entirely
    expect(m.totals.slimmed).toBe(1)
  })

  it('skips special files (FIFO/device) without reading them (no hang)', async () => {
    let readCalls = 0
    const base = makePorts({
      children: { '/in': [entry('a.png', 'file'), entry('pipe', 'special')] },
      contents: { '/in/a.png': bytes('aaaa') },
    })
    const ports: CliPorts & { written: Map<string, Uint8Array> } = {
      ...base,
      readFile: async (p) => {
        readCalls += 1
        return base.readFile(p)
      },
    }
    const m = await runFolder(ports, opts(), slimTo('x'))
    expect(m.files.map((f) => f.path)).toEqual(['a.png']) // pipe never enqueued
    expect(readCalls).toBe(1) // read only the regular file, never the FIFO
  })

  it('continues past an unreadable subdirectory (one bad dir ≠ whole run)', async () => {
    const ports = makePorts({
      children: {
        '/in': [entry('a.png', 'file'), entry('bad', 'dir')],
        '/in/bad': [entry('b.png', 'file')],
      },
      contents: { '/in/a.png': bytes('aaaa'), '/in/bad/b.png': bytes('bbbb') },
      readDirFail: ['/in/bad'],
    })
    const m = await runFolder(ports, opts(), slimTo('x'))
    expect(m.files.map((f) => f.path)).toEqual(['a.png']) // bad subtree dropped, run survives
  })

  it('emits files in deterministic (sorted) order regardless of readdir order', async () => {
    const ports = makePorts({
      children: { '/in': [entry('c.png', 'file'), entry('a.png', 'file'), entry('b.png', 'file')] },
      contents: {
        '/in/a.png': bytes('a'),
        '/in/b.png': bytes('b'),
        '/in/c.png': bytes('c'),
      },
    })
    const m = await runFolder(ports, opts(), slimTo('x'))
    expect(m.files.map((f) => f.path)).toEqual(['a.png', 'b.png', 'c.png'])
  })
})

describe('runFolder — per-file degradation', () => {
  it('records an unreadable file as skipped, not a crash', async () => {
    const ports = makePorts({
      children: { '/in': [entry('a.png', 'file')] },
      readFail: ['/in/a.png'],
    })
    const m = await runFolder(ports, opts(), slimTo('x'))
    expect(m.files[0]).toMatchObject({ path: 'a.png', action: 'skipped', reason: 'unreadable' })
    expect(ports.written.size).toBe(0)
  })

  it('records a write failure as skipped without aborting', async () => {
    const ports = makePorts({
      children: { '/in': [entry('a.png', 'file'), entry('b.png', 'file')] },
      contents: { '/in/a.png': bytes('aaaa'), '/in/b.png': bytes('bbbb') },
      writeFail: ['/out/a.png'],
    })
    const m = await runFolder(ports, opts(), slimTo('x'))
    expect(m.files.find((f) => f.path === 'a.png')).toMatchObject({
      action: 'skipped',
      reason: 'write failed',
    })
    expect(m.files.find((f) => f.path === 'b.png')?.action).toBe('slimmed') // the run continued
  })

  it('turns a throwing decide into a refused entry (bad file ≠ whole run)', async () => {
    const ports = makePorts({
      children: { '/in': [entry('a.png', 'file')] },
      contents: { '/in/a.png': bytes('aaaa') },
    })
    const decide: DecideFile = async () => {
      throw new Error('adapter blew up')
    }
    const m = await runFolder(ports, opts(), decide)
    expect(m.files[0]).toMatchObject({
      path: 'a.png',
      action: 'refused',
      reason: 'adapter blew up',
    })
  })

  it('skips the second of two inputs that collide on one output name', async () => {
    const ports = makePorts({
      children: { '/in': [entry('a.jpeg', 'file'), entry('a.png', 'file')] },
      contents: { '/in/a.jpeg': bytes('jjjj'), '/in/a.png': bytes('pppp') },
    })
    const m = await runFolder(ports, opts(), slimTo('x', 'webp')) // both → a.webp
    const actions = m.files.map((f) => f.action).sort()
    expect(actions).toEqual(['skipped', 'slimmed'])
    expect(m.files.find((f) => f.action === 'skipped')?.reason).toMatch(/collision/)
    expect([...ports.written.keys()]).toEqual(['/out/a.webp']) // only one file written
  })

  it('honours --no-copy-unknown by turning a copy into a skip', async () => {
    const ports = makePorts({
      children: { '/in': [entry('readme.md', 'file')] },
      contents: { '/in/readme.md': bytes('# hi') },
    })
    const decideCopy: DecideFile = async () => ({ action: 'copied', output: null })
    const m = await runFolder(ports, opts({ copyUnknown: false }), decideCopy)
    expect(m.files[0]).toMatchObject({ action: 'skipped' })
    expect(ports.written.size).toBe(0)
  })

  it('dry-run computes the manifest but writes nothing', async () => {
    const ports = makePorts({
      children: { '/in': [entry('a.png', 'file')] },
      contents: { '/in/a.png': bytes('aaaa') },
    })
    const m = await runFolder(ports, opts({ dryRun: true }), slimTo('x'))
    expect(m.totals.slimmed).toBe(1)
    expect(ports.written.size).toBe(0)
  })
})

describe('runFolder — parallel fan-out', () => {
  const manyFiles = (
    n: number,
  ): { children: Record<string, DirEntry[]>; contents: Record<string, Uint8Array> } => {
    const names = Array.from({ length: n }, (_, i) => `f${String(i).padStart(2, '0')}.png`)
    return {
      children: { '/in': names.map((name) => entry(name, 'file')) },
      contents: Object.fromEntries(names.map((name) => [`/in/${name}`, bytes(name)])),
    }
  }

  it('runs at most `concurrency` decides at once, and reaches the cap', async () => {
    const ports = makePorts(manyFiles(10))
    let inFlight = 0
    let peak = 0
    const decide: DecideFile = async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await Promise.resolve() // yield so sibling workers can start before this one finishes
      inFlight -= 1
      return { action: 'slimmed', output: bytes('y'), plan: 'keto', method: 't' }
    }
    await runFolder(ports, opts({ concurrency: 4 }), decide)
    expect(peak).toBe(4) // 4 workers all enter before any finishes; never more
  })

  it('stays sequential at concurrency 1', async () => {
    const ports = makePorts(manyFiles(6))
    let inFlight = 0
    let peak = 0
    const decide: DecideFile = async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await Promise.resolve()
      inFlight -= 1
      return { action: 'slimmed', output: bytes('y'), plan: 'keto', method: 't' }
    }
    await runFolder(ports, opts({ concurrency: 1 }), decide)
    expect(peak).toBe(1)
  })

  it('produces a byte-identical result at concurrency 1 and 8 (deterministic)', async () => {
    // decide returns the input path as bytes, so any nondeterminism would show up in the written content.
    const decide: DecideFile = async (rel) => ({
      action: 'slimmed',
      output: bytes(`slimmed:${rel}`),
      plan: 'keto',
      method: 't',
    })
    const run1 = makePorts(manyFiles(20))
    const run8 = makePorts(manyFiles(20))
    const m1 = await runFolder(run1, opts({ concurrency: 1 }), decide)
    const m8 = await runFolder(run8, opts({ concurrency: 8 }), decide)
    expect(m8.files).toEqual(m1.files) // same manifest (order + actions + bytes)
    expect([...run8.written.entries()]).toEqual([...run1.written.entries()]) // same output tree
  })

  it('isolates a throwing decide under concurrency — one bad file, the rest still slim', async () => {
    const ports = makePorts(manyFiles(8))
    const decide: DecideFile = async (rel) => {
      if (rel === 'f03.png') throw new Error('boom')
      return { action: 'slimmed', output: bytes('y'), plan: 'keto', method: 't' }
    }
    const m = await runFolder(ports, opts({ concurrency: 8 }), decide)
    expect(m.files.find((f) => f.path === 'f03.png')).toMatchObject({
      action: 'refused',
      reason: 'boom',
    })
    expect(m.totals.slimmed).toBe(7) // the pool didn't drain
  })

  it('re-reads a copy-through original at commit and writes it byte-for-byte', async () => {
    // copy-through bytes are NOT buffered from phase 1 — they're re-read at commit (bounded memory).
    const ports = makePorts({
      children: { '/in': [entry('readme.md', 'file')] },
      contents: { '/in/readme.md': bytes('# hello world') },
    })
    const decideCopy: DecideFile = async () => ({ action: 'copied', output: null })
    const m = await runFolder(ports, opts({ concurrency: 4 }), decideCopy)
    expect(m.files[0]).toMatchObject({ action: 'copied', outputBytes: 13 })
    expect(new TextDecoder().decode(ports.written.get('/out/readme.md'))).toBe('# hello world')
  })

  it('handles an empty folder through the pool (no workers, empty manifest)', async () => {
    const ports = makePorts(manyFiles(0))
    const m = await runFolder(ports, opts({ concurrency: 8 }), slimTo('x'))
    expect(m.files).toEqual([])
    expect(m.totals.files).toBe(0)
    expect(ports.written.size).toBe(0)
  })

  it('resolves an output-name collision to the sorted-first input at any concurrency', async () => {
    // a.jpeg and a.png both → a.webp; 'a.jpeg' < 'a.png', so it must always win.
    const decide: DecideFile = async (rel) => ({
      action: 'slimmed',
      output: bytes(`from:${rel}`),
      newExt: 'webp',
      plan: 'keto',
      method: 't',
    })
    for (const concurrency of [1, 8]) {
      const ports = makePorts({
        children: { '/in': [entry('a.png', 'file'), entry('a.jpeg', 'file')] },
        contents: { '/in/a.png': bytes('P'), '/in/a.jpeg': bytes('J') },
      })
      const m = await runFolder(ports, opts({ concurrency }), decide)
      expect(m.files.find((f) => f.action === 'slimmed')?.path).toBe('a.jpeg') // sorted-first wins
      expect(m.files.find((f) => f.action === 'skipped')?.reason).toMatch(/collision/)
      expect([...ports.written.keys()]).toEqual(['/out/a.webp'])
      expect(new TextDecoder().decode(ports.written.get('/out/a.webp'))).toBe('from:a.jpeg')
    }
  })
})

describe('runFolder — bounded memory (staged outputs + size cap)', () => {
  it('streams slimmed outputs through staging; each file keeps its OWN bytes, no temp leaks', async () => {
    // Distinct per-file payloads so a deterministic temp→dest mis-route (a.png getting b.png's bytes) is caught.
    const perFile: DecideFile = async (rel) => ({
      action: 'slimmed',
      output: bytes(`slim:${rel}`),
      plan: 'keto',
      method: 't',
    })
    const ports = makePorts({
      children: { '/in': [entry('a.png', 'file'), entry('b.png', 'file')] },
      contents: { '/in/a.png': bytes('aaaa'), '/in/b.png': bytes('bbbb') },
    })
    const m = await runFolder(ports, opts(), perFile)
    expect(m.totals.slimmed).toBe(2)
    expect(new TextDecoder().decode(ports.written.get('/out/a.png'))).toBe('slim:a.png')
    expect(new TextDecoder().decode(ports.written.get('/out/b.png'))).toBe('slim:b.png') // not mis-routed
    expect(ports.staged.size).toBe(0) // every staged temp was renamed into place — nothing leaked
  })

  it('skips a file whose staging to disk fails — no in-memory fallback (memory bound holds)', async () => {
    const ports = makePorts({
      children: { '/in': [entry('a.png', 'file')] },
      contents: { '/in/a.png': bytes('aaaa') },
      stageFail: true, // e.g. output disk full — the OLD design buffered every such output in RAM
    })
    const m = await runFolder(ports, opts(), slimTo('slim'))
    expect(m.files[0]).toMatchObject({ action: 'skipped', reason: 'stage failed' })
    expect(ports.written.size).toBe(0) // skipped, never buffered-then-written
    expect(ports.staged.size).toBe(0)
  })

  it('cleans up the staged temp of a collision loser', async () => {
    const ports = makePorts({
      children: { '/in': [entry('a.jpeg', 'file'), entry('a.png', 'file')] },
      contents: { '/in/a.jpeg': bytes('jjjj'), '/in/a.png': bytes('pppp') },
    })
    await runFolder(ports, opts(), slimTo('x', 'webp')) // both → a.webp; loser is staged then dropped
    expect([...ports.written.keys()]).toEqual(['/out/a.webp'])
    expect(ports.staged.size).toBe(0) // the loser's temp was removed, not leaked
  })

  it('cleans up the staged temp when the commit fails', async () => {
    const ports = makePorts({
      children: { '/in': [entry('a.png', 'file')] },
      contents: { '/in/a.png': bytes('aaaa') },
      writeFail: ['/out/a.png'],
    })
    const m = await runFolder(ports, opts(), slimTo('slim'))
    expect(m.files[0]).toMatchObject({ action: 'skipped', reason: 'write failed' })
    expect(ports.staged.size).toBe(0) // the orphaned temp was removed
  })

  it('dry-run stages nothing and writes nothing', async () => {
    const ports = makePorts({
      children: { '/in': [entry('a.png', 'file')] },
      contents: { '/in/a.png': bytes('aaaa') },
    })
    await runFolder(ports, opts({ dryRun: true }), slimTo('slim'))
    expect(ports.written.size).toBe(0)
    expect(ports.staged.size).toBe(0) // no temp files on a dry run
  })

  it('skips a file larger than --max-input by stat, before reading it', async () => {
    let reads = 0
    const base = makePorts({
      children: { '/in': [entry('big.png', 'file'), entry('ok.png', 'file')] },
      contents: { '/in/big.png': bytes('x'.repeat(5000)), '/in/ok.png': bytes('ok') },
    })
    const ports: CliPorts & { written: Map<string, Uint8Array> } = {
      ...base,
      readFile: async (p) => {
        reads += 1
        return base.readFile(p)
      },
    }
    const m = await runFolder(ports, opts({ maxInputBytes: 1000 }), slimTo('slim'))
    const big = m.files.find((f) => f.path === 'big.png')
    expect(big).toMatchObject({ action: 'skipped' })
    expect(big?.reason).toMatch(/too large/)
    expect(big?.inputBytes).toBe(5000) // reported from the stat, not a read
    expect(m.files.find((f) => f.path === 'ok.png')?.action).toBe('slimmed') // the small file still runs
    expect(reads).toBe(1) // the oversized file was never read into memory
  })

  it('falls through to a normal read when stat fails but the file is readable', async () => {
    // If the cap can't measure the size (stat throws), it falls through to the read rather than aborting.
    const base = makePorts({
      children: { '/in': [entry('a.png', 'file')] },
      contents: { '/in/a.png': bytes('aaaa') },
    })
    const ports: CliPorts & { written: Map<string, Uint8Array> } = {
      ...base,
      size: async () => {
        throw new Error('EACCES stat')
      },
    }
    const m = await runFolder(ports, opts({ maxInputBytes: 1 }), slimTo('slim'))
    expect(m.files[0]).toMatchObject({ action: 'slimmed' }) // stat unknown → read succeeded → slimmed
  })

  it('skips unreadable when both stat and read fail under --max-input', async () => {
    const base = makePorts({
      children: { '/in': [entry('a.png', 'file')] },
      contents: { '/in/a.png': bytes('aaaa') },
      readFail: ['/in/a.png'],
    })
    const ports: CliPorts & { written: Map<string, Uint8Array> } = {
      ...base,
      size: async () => {
        throw new Error('EACCES stat')
      },
    }
    const m = await runFolder(ports, opts({ maxInputBytes: 1 }), slimTo('slim'))
    expect(m.files[0]).toMatchObject({ action: 'skipped', reason: 'unreadable' })
  })
})

describe('runFolder — cancellation', () => {
  it('skips every file as "aborted" when the signal is already aborted (nothing written)', async () => {
    const ac = new AbortController()
    ac.abort()
    const ports = makePorts({
      children: { '/in': [entry('a.png', 'file'), entry('b.png', 'file')] },
      contents: { '/in/a.png': bytes('aaaa'), '/in/b.png': bytes('bbbb') },
    })
    const m = await runFolder(ports, opts({ signal: ac.signal }), slimTo('slim'))
    expect(m.files).toHaveLength(2)
    expect(m.files.every((f) => f.action === 'skipped' && f.reason === 'aborted')).toBe(true)
    expect(ports.written.size).toBe(0) // no file started → nothing written
    expect(ports.staged.size).toBe(0)
  })
})
