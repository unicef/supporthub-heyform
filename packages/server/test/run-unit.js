#!/usr/bin/env node
/**
 * Runs every `test/*.test.ts` unit file.
 *
 * These files existed for a long time and nothing ever ran them: `pnpm test`
 * maps to `test:e2e`, which runs `test/e2e/run.ts`, and that imports only the
 * `*.e2e.test.ts` suites by name. Nothing globbed this directory, so nine test
 * files could never fail a build — which is worse than having none, because it
 * reads as coverage. See unicef/supporthub#362.
 *
 * Each file is SPAWNED rather than required, because they gate their own
 * execution on `require.main === module`. Requiring them would define the tests
 * and run nothing.
 */
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const testDir = __dirname
const files = fs
  .readdirSync(testDir)
  .filter(name => name.endsWith('.test.ts'))
  .sort()

if (files.length === 0) {
  console.error('run-unit: no test/*.test.ts files found')
  process.exit(1)
}

let failed = 0

for (const file of files) {
  const started = Date.now()
  const result = spawnSync(
    process.execPath,
    [
      path.join(__dirname, '..', 'node_modules', 'ts-node', 'dist', 'bin.js'),
      '--transpile-only',
      '-r',
      'tsconfig-paths/register',
      path.join(testDir, file)
    ],
    { cwd: path.join(__dirname, '..'), encoding: 'utf8' }
  )
  const ms = Date.now() - started
  const ok = result.status === 0
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${file}  (${ms}ms)`)
  if (!ok) {
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
  }
}

console.log(`\n${files.length - failed}/${files.length} unit test files passed`)
process.exit(failed === 0 ? 0 : 1)
