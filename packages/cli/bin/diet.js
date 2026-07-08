#!/usr/bin/env node
import { run, nodePorts } from '../dist/index.js'

const result = await run(process.argv.slice(2), nodePorts)
// Set exitCode and let stdout flush naturally — a synchronous process.exit() can truncate a piped write.
process.exitCode = result.code
process.stdout.write(result.output)
