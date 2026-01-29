import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, '..');
const serverDir = path.join(repoRoot, 'server');
const nextServerDir = path.join(serverDir, '.next', 'server');

const needle = 'Workflow designer requires Enterprise Edition. Please upgrade to access this feature.';
const needleBytes = Buffer.from(needle, 'utf8');

const legacyEntryCandidates = [
  path.join(repoRoot, 'packages', 'workflows', 'src', 'entry.ts'),
  path.join(repoRoot, 'packages', 'workflows', 'src', 'entry.tsx'),
  path.join(repoRoot, 'packages', 'workflows', 'src', 'ee', 'entry.tsx'),
  path.join(repoRoot, 'packages', 'workflows', 'src', 'oss', 'entry.tsx'),
];

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
    throw new Error(`Expected directory does not exist: ${targetDir}`);
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

const legacyHits = legacyEntryCandidates.filter((candidate) => fs.existsSync(candidate));
if (legacyHits.length) {
  console.error('\n[guard-ee-workflows-next-build] FAIL: legacy workflows entrypoints still exist (expected deleted)\n');
  for (const filePath of legacyHits) {
    console.error(`- ${path.relative(repoRoot, filePath)}`);
  }
  process.exit(1);
}

if (!skipBuild) {
  fs.rmSync(path.join(serverDir, '.next'), { recursive: true, force: true });

  const build = spawnSync('npm', ['-w', 'server', 'run', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      EDITION: 'enterprise',
      NEXT_PUBLIC_EDITION: 'enterprise',
    },
  });

  if (typeof build.status === 'number' && build.status !== 0) {
    process.exit(build.status);
  }

  if (build.error) {
    throw build.error;
  }
}

const hits = scanForNeedle(nextServerDir);
if (hits.length) {
  console.error(`\n[guard-ee-workflows-next-build] FAIL: found workflows CE stub string in EE build output under ${nextServerDir}\n`);
  for (const filePath of hits) {
    console.error(`- ${path.relative(repoRoot, filePath)}`);
  }
  process.exit(1);
}

console.log(`[guard-ee-workflows-next-build] OK: no workflows CE stub string found under ${nextServerDir}`);
