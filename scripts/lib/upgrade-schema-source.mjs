import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Materialize the old release, including migration helpers. Never substitute
// candidate helpers for the baseline or reset its ledger during upgrade.
export function prepareUpgradeSchema({ repository, commit, destination, edition = 'ee' }) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Upgrade baseline requires a full commit SHA');
  if (!['ce', 'ee'].includes(edition)) throw new Error('Edition must be ce or ee');
  const resolved = execFileSync('git', ['rev-parse', `${commit}^{commit}`], { cwd: repository, encoding: 'utf8' }).trim();
  if (resolved !== commit) throw new Error('Baseline commit did not resolve exactly');
  destination = path.resolve(destination);
  // Exclusive creation prevents overwriting another fixture or reusing stale files.
  mkdirSync(destination);
  const archive = path.join(destination, 'baseline.tar');
  try {
    const directories = ['server/migrations', ...(edition === 'ee' ? ['ee/server/migrations'] : [])];
    execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, commit], { cwd: repository });
    execFileSync('tar', ['-xf', archive, '-C', destination]);
    rmSync(archive);
    const merged = path.join(destination, 'server/combined-migrations');
    mkdirSync(merged);
    for (const directory of directories) {
      const source = path.join(destination, directory);
      for (const entry of readdirSync(source, { withFileTypes: true })) {
        if ((entry.isFile() && entry.name.endsWith('.cjs')) || (entry.isDirectory() && entry.name === 'utils')) {
          cpSync(path.join(source, entry.name), path.join(merged, entry.name), { recursive: true });
        }
      }
    }
    const migrations = readdirSync(merged).filter(name => name.endsWith('.cjs')).sort();
    if (!migrations.length) throw new Error('Baseline contains no migrations');
    const manifest = { schemaVersion: 1, commit, edition, migrations };
    writeFileSync(path.join(destination, 'source.json'), JSON.stringify(manifest, null, 2) + '\n');
    return { directory: merged, manifest };
  } catch (error) {
    rmSync(destination, { recursive: true, force: true });
    throw error;
  }
}
