import test from 'node:test';
import assert from 'node:assert/strict';
import { planDevDependencyBuilds } from './devDependencyPlanner.mjs';

const taskGraph = {
  tasks: {
    tasks: {
      'shared:build': { id: 'shared:build', target: { project: 'shared', target: 'build' } },
      'feature:build': { id: 'feature:build', target: { project: 'feature', target: 'build' } },
      'server:build': { id: 'server:build', target: { project: 'server', target: 'build' } },
      'server:build-deps': { id: 'server:build-deps', target: { project: 'server', target: 'build-deps' } }
    },
    dependencies: {
      'shared:build': [],
      'feature:build': ['shared:build', 'server:build'],
      'server:build': [],
      'server:build-deps': ['feature:build']
    }
  }
};

test('builds dependency outputs in graph order while excluding the app build pulled in by a cycle', () => {
  const waves = planDevDependencyBuilds(taskGraph, 'server');

  assert.deepEqual(waves, [['shared'], ['feature']]);
  assert.equal(waves.flat().includes('server'), false);
});

test('fails when the remaining workspace dependency targets contain a cycle', () => {
  const cyclicGraph = structuredClone(taskGraph);
  cyclicGraph.tasks.dependencies['shared:build'] = ['feature:build'];

  assert.throws(() => planDevDependencyBuilds(cyclicGraph, 'server'), /Cannot order development dependency builds/);
});
