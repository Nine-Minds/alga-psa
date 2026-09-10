#!/usr/bin/env node
import { isApplianceNodeTest } from './lib/test-discovery.mjs';
import { runNodeSuite } from './lib/run-node-suite.mjs';

runNodeSuite({
  suite: 'appliance',
  isCandidate: isApplianceNodeTest,
  prepare: [{ command: 'npm', args: ['--prefix', 'ee/appliance/status-ui', 'run', 'build'] }],
});
