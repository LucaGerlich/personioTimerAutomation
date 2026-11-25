import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runActionInChild } from './runner.ts'
import type { PersonioAction } from './types.ts'

test('child that exits without a result resolves to failed instead of hanging', { timeout: 10_000 }, async () => {
	// cli.ts exits with code 1 on an unknown action (or missing config) before Playwright is touched
	const result = await runActionInChild('bogus' as PersonioAction)
	assert.equal(result.status, 'failed')
	assert.match(result.message, /crashed \(exit code 1\)/)
})
