/**
 * `onadiet` — the `diet` CLI (the front door; published unscoped).
 *
 * `run(argv, ports)` is the testable core: it parses args and drives the engine (`@onadiet/pdf`) entirely
 * through injected {@link CliPorts}, so there's no direct filesystem contact here. The bin (`bin/diet.js`)
 * supplies the real {@link nodePorts} and does the process wiring. The engine is bundled so `npm i -g onadiet`
 * is self-contained (only sharp + pdf-lib are external native/runtime deps).
 */
import { VERB_COMMANDS } from './args'

export { run, HELP, type RunResult } from './run'
export { nodePorts, type CliPorts } from './ports'
export { parseArgs, type Parsed, type Options, type RunCommand } from './args'

/**
 * Re-export the `@onadiet/core` engine API so the flagship `onadiet` is a one-stop import
 * (`import { resolvePlan, parseSize, DIET_PLANS, searchSize, OnadietError } from 'onadiet'`) as well as the
 * `diet` CLI. The engine is already bundled (tsup `noExternal`), so this adds no runtime dependency.
 */
export * from '@onadiet/core'

/** The `diet` sub-commands (the diet metaphor). The default (bare path) slims the target. */
export const COMMANDS = VERB_COMMANDS
export type Command = (typeof COMMANDS)[number]
