#!/usr/bin/env node
import { isNodeToolingTest } from './lib/test-discovery.mjs';
import { runNodeSuite } from './lib/run-node-suite.mjs';

runNodeSuite({
  suite: 'node-tooling',
  isCandidate: isNodeToolingTest,
  exclusionFile: 'scripts/node-test-exclusions.json',
  prepare: ['@alga-psa/emulator-host', '@alga-psa/emulator-stripe'].map(workspace => ({
    command: 'npm', args: ['run', 'build', `--workspace=${workspace}`],
  })),
});
