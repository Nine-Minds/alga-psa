import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

// A server-unit shard that hits its job timeout uploads null evidence even when
// every file it ran is green, and that null evidence fails the
// server-unit-complete, repository-inventory and readiness gates downstream.
// The long silent tail after the last test module is v8 coverage remapping, not
// a hang, so the ceiling has to cover the whole measured shard, tail included.
//
// Measured on 2026-10-31: main shards ran 33-44.6 minutes, and PR 4015's
// shard 1 needed more than 45m27s (cancelled there with all 1036 files green).
const MEASURED_PEAK_MINUTES = 46;
const REQUIRED_HEADROOM_MINUTES = 10;

const workflow = () => yaml.load(readFileSync('.github/workflows/unit-tests.yml', 'utf8'));

test('server-unit shards get a ceiling above the measured peak with headroom for runner variance', () => {
  const job = workflow().jobs['server-unit'];
  assert.ok(job, 'unit-tests.yml still defines the server-unit shard job');
  const ceiling = job['timeout-minutes'];
  assert.equal(typeof ceiling, 'number', 'the shard job keeps an explicit timeout-minutes ceiling');
  assert.ok(
    ceiling >= MEASURED_PEAK_MINUTES + REQUIRED_HEADROOM_MINUTES,
    `a ${ceiling}-minute ceiling kills shards that measured up to ${MEASURED_PEAK_MINUTES} minutes; ` +
      `keep at least ${REQUIRED_HEADROOM_MINUTES} minutes of headroom`,
  );
});
