import { spawnSync } from 'node:child_process';

export function testRevision(root) {
  const run = (args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`Cannot read test revision: git ${args[0]} failed`);
    return result.stdout;
  };
  const revision = run(['rev-parse', 'HEAD']).trim();
  const entries = run(['status', '--porcelain=v1', '-z', '--untracked-files=normal']).split('\0');
  const changes = [];
  for (let i = 0; i < entries.length; i++) {
    if (!entries[i]) continue;
    const status = entries[i].slice(0, 2);
    const file = entries[i].slice(3);
    const change = { status, file };
    // NUL output places the new path first, followed by the original path.
    if (/[RC]/.test(status)) change.from = entries[++i];
    changes.push(change);
  }
  return { revision, dirty: changes.length > 0, changes };
}
