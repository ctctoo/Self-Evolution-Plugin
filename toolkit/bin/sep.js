#!/usr/bin/env node
/**
 * `sep` CLI launcher. Requires a build (`pnpm run build`) so that
 * `../lib/cli.js` exists. For a build-less run, use
 * `node src/cli.ts <command>` (Node ≥ 23.6 with type stripping).
 */
import { main } from '../lib/cli.js'

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code
})
