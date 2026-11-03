import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planDevDependencyBuilds } from './devDependencyPlanner.mjs';

function runNx(args) {
  execFileSync('npx', ['nx', ...args], { stdio: 'inherit' });
}

const graphDir = mkdtempSync(join(tmpdir(), 'alga-dev-deps-'));
const graphFile = join(graphDir, 'task-graph.json');

try {
  runNx(['build-deps', 'server', `--graph=${graphFile}`, '--dry-run']);
  const graph = JSON.parse(readFileSync(graphFile, 'utf8'));
  const waves = planDevDependencyBuilds(graph, 'server');

  for (const projects of waves) {
    runNx([
      'run-many',
      '--target=build',
      `--projects=${projects.join(',')}`,
      '--excludeTaskDependencies',
      '--parallel=4',
      '--outputStyle=stream'
    ]);
  }
} finally {
  rmSync(graphDir, { recursive: true, force: true });
}
