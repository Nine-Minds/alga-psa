import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, '..');
const serverDir = path.join(repoRoot, 'server');
const nextDir = path.join(serverDir, '.next');
const nextServerDir = path.join(nextDir, 'server');
const nextStaticDir = path.join(nextDir, 'static');

const needle = 'Workflow designer requires Enterprise Edition. Please upgrade to access this feature.';
const needleBytes = Buffer.from(needle, 'utf8');

function walkFiles(rootDir) {
  const stack = [rootDir];
  const files = [];

  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }

  return files;
}

function scanForNeedle(targetDir) {
  if (!fs.existsSync(targetDir)) {
    return [];
  }

  const matches = [];
  const files = walkFiles(targetDir);

  for (const filePath of files) {
    const contents = fs.readFileSync(filePath);
    if (contents.includes(needleBytes)) {
      matches.push(filePath);
    }
  }

  return matches;
}

const args = new Set(process.argv.slice(2));
const skipBuild = args.has('--skip-build');

if (!skipBuild) {
  fs.rmSync(nextDir, { recursive: true, force: true });

  const build = spawnSync('npm', ['-w', 'server', 'run', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      EDITION: 'community',
      NEXT_PUBLIC_EDITION: 'community',
    },
  });

  if (typeof build.status === 'number' && build.status !== 0) {
    process.exit(build.status);
  }

  if (build.error) {
    throw build.error;
  }
}

const hits = [...scanForNeedle(nextServerDir), ...scanForNeedle(nextStaticDir)];
if (!hits.length) {
  console.error(`\n[guard-ce-workflows-next-build] FAIL: did not find workflows CE stub string in CE build output under ${nextDir}\n`);
  process.exit(1);
}

console.log(`[guard-ce-workflows-next-build] OK: found workflows CE stub string in CE build output (${hits.length} file(s))`);

