import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

// The "Install Playwright system dependencies" step retries a bounded
// `apt-get` so a stalled mirror self-heals, and carries a `timeout-minutes`
// ceiling so it can never consume the whole job budget. Those two numbers are
// written in different places and drifted apart: 3 attempts of 240s plus the
// pauses between them came to 740s under a 720s ceiling, so the action killed
// the step mid-attempt and the loop could never report its own failure. Both
// browser editions then produced no runner.json and every downstream readiness
// verdict failed. Keep the loop strictly inside the ceiling.
const step = () => {
  const workflow = yaml.load(readFileSync('.github/workflows/e2e-fresh-install-tests.yaml', 'utf8'));
  const job = workflow.jobs['production-browser'];
  const found = job.steps.find(step => step.id === 'browser_system');
  assert.ok(found, 'the production browser job still installs Playwright system dependencies');
  return found;
};

test('the apt retry loop fits inside the step ceiling with headroom to report its own failure', () => {
  const { run } = step();
  const attempts = Number(run.match(/^\s*max_attempts=(\d+)$/m)[1]);
  const perAttempt = Number(run.match(/^\s*until timeout (\d+) npx playwright install-deps/m)[1]);
  const pause = Number(run.match(/^\s*sleep (\d+)$/m)[1]);
  const ceiling = step()['timeout-minutes'] * 60;

  const budget = attempts * perAttempt + (attempts - 1) * pause;
  assert.ok(attempts > 1, 'a single attempt is not a retry');
  assert.ok(
    budget < ceiling,
    `retry budget ${budget}s must stay under the ${ceiling}s ceiling so the loop, not the action, reports the failure`,
  );
});

test('the step keeps a hard ceiling well inside the job budget', () => {
  const workflow = yaml.load(readFileSync('.github/workflows/e2e-fresh-install-tests.yaml', 'utf8'));
  const job = workflow.jobs['production-browser'];
  const ceiling = job.steps.find(step => step.id === 'browser_system')['timeout-minutes'];

  assert.ok(ceiling, 'the step keeps an explicit timeout-minutes ceiling');
  assert.ok(
    ceiling < job['timeout-minutes'] / 2,
    `installing browser dependencies must not be able to claim half of the job's ${job['timeout-minutes']}-minute budget`,
  );
});
