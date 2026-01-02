import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

describe('Extension scheduled tasks plan folder', () => {
  it('validate_plan.py passes', () => {
    const repoRoot = path.resolve(__dirname, '../../../../..')
    const planDir = path.join(repoRoot, 'ee/docs/plans/2026-01-01-extension-scheduled-tasks')
    const validator = path.join(repoRoot, 'scripts/validate_plan.py')

    const output = execFileSync('python3', [validator, planDir], {
      cwd: repoRoot,
      encoding: 'utf-8',
    })

    expect(output).toContain('looks valid')
    expect(output).toContain('features.json features')
    expect(output).toContain('tests.json tests')
  })
})

