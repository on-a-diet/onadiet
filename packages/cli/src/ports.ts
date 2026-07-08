/**
 * I/O ports — the CLI's only contact with the filesystem. `run` depends on this interface (never on `fs`
 * directly), so it's testable with in-memory fakes; {@link nodePorts} is the real implementation the bin uses.
 *
 * `writeFileAtomic` writes to a temp file in the destination directory then atomically renames it into place,
 * so a crash mid-write can never leave a half-written (corrupt) output. `sameFile` compares real filesystem
 * identity (dev+inode) so the "never overwrite the original" guard can't be fooled by symlinks, a
 * case-insensitive filesystem, or Unicode-normalization differences that a string compare would miss.
 */
import { randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  readdir,
  readFile as read,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** One entry from a directory listing — enough for the walk to recurse, skip symlinks, and enqueue only
 * regular files (a FIFO/device/socket would block or misbehave on read, so the walk must ignore it). */
export interface DirEntry {
  readonly name: string
  readonly isDirectory: boolean
  readonly isSymbolicLink: boolean
  /** A regular file (not a FIFO, device, socket, …). Only these are safe to read + slim. */
  readonly isFile: boolean
}

export interface CliPorts {
  readFile(path: string): Promise<Uint8Array>
  /** Write `bytes` to `path` atomically (temp file + rename). */
  writeFileAtomic(path: string, bytes: Uint8Array): Promise<void>
  /** True iff both paths exist and refer to the same filesystem object (dev+inode). */
  sameFile(a: string, b: string): Promise<boolean>
  /** True iff `path` exists and is a directory (folder mode); false for a file or a missing path. */
  isDirectory(path: string): Promise<boolean>
  /** Byte size of `path` (via stat, no read) — for folder `weigh`/`check` budgets over large trees. */
  size(path: string): Promise<number>
  /** True iff `path` exists and is itself a symlink (lstat, no follow). Guards the output root against a
   * pre-planted symlink that would redirect writes outside the intended tree. */
  isSymlink(path: string): Promise<boolean>
  /** List `path`'s immediate entries (names + kind). Used by the recursive folder walk. */
  readDir(path: string): Promise<readonly DirEntry[]>
  /** Create `path` and any missing parents (idempotent) — for the mirrored output tree. */
  mkdirp(path: string): Promise<void>
  /** Stream a slimmed folder output to a temp file inside `dir` (its eventual **destination directory**, which
   * is created if missing, so the commit rename is a same-directory atomic move — never cross-device) and
   * return its path. Lets folder mode stage outputs to disk as they're produced instead of holding every
   * slimmed buffer in memory until the commit phase. */
  stageTemp(dir: string, bytes: Uint8Array): Promise<string>
  /** Atomically move a staged temp file into place (rename); staged in the destination's own directory, so no
   * mkdir is needed here and the rename can't hit EXDEV. */
  commitStaged(tempPath: string, dest: string): Promise<void>
  /** Remove a staged temp file — best-effort cleanup for a collision loser or a failed commit (never throws). */
  removeTemp(tempPath: string): Promise<void>
}

export const nodePorts: CliPorts = {
  async readFile(path) {
    return read(path)
  },
  async writeFileAtomic(path, bytes) {
    const tmp = join(dirname(path), `.onadiet-${randomUUID()}.tmp`)
    try {
      await writeFile(tmp, bytes)
      await rename(tmp, path)
    } catch (error) {
      await rm(tmp, { force: true }) // don't leave a stray temp file behind
      throw error
    }
  },
  async sameFile(a, b) {
    try {
      const [sa, sb] = await Promise.all([stat(a), stat(b)])
      return sa.dev === sb.dev && sa.ino === sb.ino
    } catch {
      return false // one (or both) doesn't exist → cannot be the same file
    }
  },
  async isDirectory(path) {
    try {
      return (await stat(path)).isDirectory()
    } catch {
      return false
    }
  },
  async size(path) {
    return (await stat(path)).size
  },
  async isSymlink(path) {
    try {
      return (await lstat(path)).isSymbolicLink()
    } catch {
      return false // missing → not a symlink
    }
  },
  async readDir(path) {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      isSymbolicLink: e.isSymbolicLink(),
      isFile: e.isFile(),
    }))
  },
  async mkdirp(path) {
    await mkdir(path, { recursive: true })
  },
  async stageTemp(dir, bytes) {
    // The temp lives in its destination directory (created on demand) so the later commit rename stays in one
    // directory — atomic and never cross-device (EXDEV). A UUID name can't collide across concurrent workers.
    await mkdir(dir, { recursive: true })
    const tmp = join(dir, `.onadiet-${randomUUID()}.tmp`)
    await writeFile(tmp, bytes)
    return tmp
  },
  async commitStaged(tempPath, dest) {
    await rename(tempPath, dest)
  },
  async removeTemp(tempPath) {
    // Best-effort by contract: `force` already ignores a missing file; swallow the rest (EPERM/EBUSY/…) so a
    // cleanup failure can never abort the run.
    await rm(tempPath, { force: true }).catch(() => {})
  },
}
