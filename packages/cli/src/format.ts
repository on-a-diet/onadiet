/**
 * Receipt formatting — pure functions from a result to the string the CLI prints. Human text by default;
 * `--json` emits a stable object (on stdout) so the CLI is scriptable and agent-safe.
 */
import { formatBytes, savedPercent } from '@onadiet/core'
import type {
  DietPlan,
  FolderCheckReport,
  FolderFileEntry,
  FolderManifest,
  FolderWeighReport,
  SlimResult,
  Weight,
} from '@onadiet/core'

function stringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function percent(part: number, total: number): string {
  if (total <= 0) return '0%'
  return `${Math.round((part / total) * 100)}%`
}

/** `diet weigh` — total weight and what's heavy. */
export function formatWeigh(file: string, weight: Weight, json: boolean): string {
  if (json) {
    return stringify({
      ok: true,
      action: 'weigh',
      file,
      bytes: weight.bytes,
      causes: weight.causes,
    })
  }
  const lines = [`${file} weighs ${formatBytes(weight.bytes)}`]
  for (const cause of weight.causes) {
    lines.push(
      `  ${percent(cause.bytes, weight.bytes).padStart(4)}  ${cause.label} (${formatBytes(cause.bytes)})`,
    )
  }
  return `${lines.join('\n')}\n`
}

/** `diet <file>` / `diet plan` — the slim receipt (or the honest non-success). */
export function formatSlim(
  file: string,
  result: SlimResult,
  outPath: string | null,
  opts: { json: boolean; dryRun: boolean },
): string {
  const { outcome } = result
  if (!outcome.ok) {
    if (opts.json) {
      return stringify({
        ok: false,
        action: 'slim',
        file,
        reason: outcome.reason,
        detail: outcome.detail,
      })
    }
    return `${file}: ${outcome.reason} — ${outcome.detail}\n`
  }
  if (outcome.keptOriginal) {
    if (opts.json) {
      return stringify({
        ok: true,
        action: 'slim',
        file,
        keptOriginal: true,
        method: outcome.method,
      })
    }
    return `${file}: ${outcome.method} — nothing smaller to write.\n`
  }

  const saved = savedPercent(outcome.inputBytes, outcome.outputBytes)
  if (opts.json) {
    return stringify({
      ok: true,
      action: opts.dryRun ? 'plan' : 'slim',
      file,
      output: opts.dryRun ? null : outPath,
      inputBytes: outcome.inputBytes,
      outputBytes: outcome.outputBytes,
      savedPercent: saved,
      plan: outcome.plan,
      method: outcome.method,
    })
  }
  const verb = opts.dryRun ? 'would slim' : 'slimmed'
  const dest = opts.dryRun ? '' : ` → ${outPath}`
  return (
    `${verb} ${file}: ${formatBytes(outcome.inputBytes)} → ${formatBytes(outcome.outputBytes)} ` +
    `(${saved}% off, ${outcome.method})${dest}\n`
  )
}

/**
 * `diet check <file>` — a CI budget weigh-in. Accepts `--max` and/or `--max-total`; the file must satisfy
 * each, so the gate is the binding (smaller) budget. The JSON echoes back exactly the budgets that were
 * passed (never under the wrong key), so a script reads what it asked for.
 */
export function formatCheck(
  file: string,
  bytes: number,
  budgets: { maxBytes?: number; maxTotal?: number },
  json: boolean,
): string {
  const binding = Math.min(budgets.maxBytes ?? Infinity, budgets.maxTotal ?? Infinity)
  const pass = bytes <= binding
  if (json) {
    return stringify({
      ok: pass,
      action: 'check',
      file,
      bytes,
      ...(budgets.maxBytes !== undefined ? { maxBytes: budgets.maxBytes } : {}),
      ...(budgets.maxTotal !== undefined ? { maxTotal: budgets.maxTotal } : {}),
    })
  }
  const verdict = pass ? 'PASS' : 'FAIL'
  const rel = pass ? 'within' : 'over'
  return `${verdict} ${file}: ${formatBytes(bytes)} ${rel} budget ${formatBytes(binding)}\n`
}

/** One line of the human folder manifest. */
function folderLine(f: FolderFileEntry): string {
  switch (f.action) {
    case 'skipped':
      return `  ${f.path}  — skipped${f.reason !== undefined ? ` (${f.reason})` : ''}`
    case 'copied':
      return `  ${f.path}  — copied (not a recognized type)`
    case 'refused':
      return `  ${f.path}  ✋ ${f.reason ?? 'refused'} — copied through untouched`
    case 'kept':
      return `  ${f.path}  ${formatBytes(f.inputBytes)} — kept original (already smallest)`
    case 'slimmed': {
      const saved = savedPercent(f.inputBytes, f.outputBytes)
      const how = f.method ?? f.plan ?? ''
      const renamed =
        f.outputPath !== undefined && f.outputPath !== f.path ? ` → ${f.outputPath}` : ''
      return `  ${f.path}  ${formatBytes(f.inputBytes)} → ${formatBytes(f.outputBytes)} (${saved}% off, ${how})${renamed}`
    }
  }
}

/** The shared human manifest body: the counts line, each file's line, a rule, and the total. `saved` uses
 * `totals.savedPercent` (0-safe from aggregateFolder — core `savedPercent` throws on inputBytes<=0). */
function folderBody(manifest: FolderManifest, totalSuffix: string): string[] {
  const { files, totals } = manifest
  return [
    `  slimmed ${totals.slimmed} · copied ${totals.copied} · kept ${totals.kept} · refused ${totals.refused}` +
      (totals.skipped > 0 ? ` · skipped ${totals.skipped}` : ''),
    ...files.map(folderLine),
    `  ${'─'.repeat(52)}`,
    `  total  ${formatBytes(totals.inputBytes)} → ${formatBytes(totals.outputBytes)} (${totals.savedPercent}% off)${totalSuffix}`,
  ]
}

/** `diet <dir>` / `diet plan <dir>` — the folder manifest (per-file lines + totals). */
export function formatFolder(
  inputDir: string,
  outputDir: string,
  manifest: FolderManifest,
  opts: { json: boolean; dryRun: boolean },
): string {
  const { files, totals } = manifest
  if (opts.json) {
    return stringify({
      ok: true,
      action: opts.dryRun ? 'plan' : 'slim',
      input: inputDir,
      output: opts.dryRun ? null : outputDir,
      files,
      totals,
    })
  }
  const dest = opts.dryRun ? '(dry run — no writes)' : `→ ${outputDir}`
  const header = `${inputDir} ${dest}   ${totals.files} file${totals.files === 1 ? '' : 's'}`
  const suffix = opts.dryRun ? '' : `   ${outputDir}`
  return `${[header, ...folderBody(manifest, suffix)].join('\n')}\n`
}

/**
 * `diet <dir> --to-total <budget>` / `plan` — the whole-folder budget report. Three honest outcomes:
 * `fit` (names the gentlest plan that fit), `infeasible` (even `crash` overflows — reports the smallest the
 * plan-sweep achieves), and `overran` (the winner fit on the dry-run but the written tree exceeded the budget,
 * e.g. the folder changed between planning and writing — reported, not silently labelled a fit).
 */
export function formatFolderBudget(
  inputDir: string,
  outputDir: string,
  budget: number,
  result:
    | { kind: 'fit'; plan: DietPlan; manifest: FolderManifest }
    | { kind: 'overran'; plan: DietPlan; manifest: FolderManifest }
    | { kind: 'infeasible'; manifest: FolderManifest },
  opts: { json: boolean; dryRun: boolean },
): string {
  const { totals } = result.manifest
  const wrote = result.kind !== 'infeasible' && !opts.dryRun // infeasible/dry-run write nothing
  if (opts.json) {
    return stringify({
      ok: result.kind === 'fit',
      action: opts.dryRun ? 'plan' : 'slim',
      input: inputDir,
      output: wrote ? outputDir : null,
      budget,
      fit: result.kind === 'fit',
      ...(result.kind === 'infeasible' ? {} : { plan: result.plan }),
      ...(result.kind === 'overran' ? { overran: true } : {}),
      files: result.manifest.files,
      totals,
    })
  }
  if (result.kind === 'infeasible') {
    return (
      `${inputDir}: ${formatBytes(budget)} budget infeasible — the smallest this plan-sweep reaches is ` +
      `${formatBytes(totals.outputBytes)} (raise the budget to ~${formatBytes(totals.outputBytes)}; ` +
      `a finer per-file pass may do better)\n`
    )
  }
  if (result.kind === 'overran') {
    return (
      `${inputDir} → ${outputDir}: applied plan ${result.plan} but the written total is ` +
      `${formatBytes(totals.outputBytes)}, over the ${formatBytes(budget)} budget ` +
      `(the folder changed between planning and writing)\n`
    )
  }
  const dest = opts.dryRun ? '(dry run — no writes)' : `→ ${outputDir}`
  const header =
    `${inputDir} ${dest}   fit under ${formatBytes(budget)} at plan ${result.plan}   ` +
    `${totals.files} file${totals.files === 1 ? '' : 's'}`
  const suffix = opts.dryRun ? '' : `   ${outputDir}`
  return `${[header, ...folderBody(result.manifest, suffix)].join('\n')}\n`
}

/** `diet weigh <dir>` — a size overview: a by-kind breakdown + the heaviest files + the folder total. */
export function formatFolderWeigh(dir: string, report: FolderWeighReport, json: boolean): string {
  if (json) {
    return stringify({
      ok: true,
      action: 'weigh',
      dir,
      totalFiles: report.totalFiles,
      totalBytes: report.totalBytes,
      byKind: report.byKind,
      files: report.files,
    })
  }
  const n = report.totalFiles
  const lines = [`${dir}   ${n} file${n === 1 ? '' : 's'}, ${formatBytes(report.totalBytes)}`]
  for (const kind of ['image', 'pdf', 'svg', 'other'] as const) {
    const k = report.byKind[kind]
    if (k.files === 0) continue
    lines.push(
      `  ${kind.padEnd(6)} ${String(k.files).padStart(4)}  ${formatBytes(k.bytes).padStart(9)}  (${percent(k.bytes, report.totalBytes)})`,
    )
  }
  const heaviest = report.files.slice(0, 5)
  if (heaviest.length > 0) {
    lines.push('  heaviest:')
    for (const f of heaviest) lines.push(`    ${formatBytes(f.bytes).padStart(9)}  ${f.path}`)
  }
  return `${lines.join('\n')}\n`
}

/** `diet check <dir>` — the CI gate verdict: which files breached `--max`, and the total vs `--max-total`. */
export function formatFolderCheck(dir: string, report: FolderCheckReport, json: boolean): string {
  if (json) {
    return stringify({
      ok: report.pass,
      action: 'check',
      dir,
      totalFiles: report.totalFiles,
      totalBytes: report.totalBytes,
      ...(report.maxBytes !== undefined ? { maxBytes: report.maxBytes } : {}),
      ...(report.maxTotal !== undefined ? { maxTotal: report.maxTotal } : {}),
      over: report.over,
      overTotal: report.overTotal,
      pass: report.pass,
    })
  }
  const n = report.totalFiles
  const lines = [
    `${report.pass ? 'PASS' : 'FAIL'} ${dir}   ${n} file${n === 1 ? '' : 's'}, ${formatBytes(report.totalBytes)}`,
  ]
  if (report.maxBytes !== undefined) {
    if (report.over.length === 0) {
      lines.push(`  per-file ≤ ${formatBytes(report.maxBytes)}: all within`)
    } else {
      lines.push(`  per-file ≤ ${formatBytes(report.maxBytes)}: ${report.over.length} over`)
      for (const f of report.over)
        lines.push(`    ✗ ${formatBytes(f.bytes).padStart(9)}  ${f.path}`)
    }
  }
  if (report.maxTotal !== undefined) {
    lines.push(
      `  total ${formatBytes(report.totalBytes)} ${report.overTotal ? 'OVER' : 'within'} budget ${formatBytes(report.maxTotal)}`,
    )
  }
  return `${lines.join('\n')}\n`
}

/** `diet checkup` — which local engines are available. */
export function formatCheckup(engines: Readonly<Record<string, string>>, json: boolean): string {
  if (json) return stringify({ ok: true, action: 'checkup', engines })
  const lines = ['onadiet checkup:']
  for (const [name, status] of Object.entries(engines)) lines.push(`  ${name}: ${status}`)
  return `${lines.join('\n')}\n`
}
