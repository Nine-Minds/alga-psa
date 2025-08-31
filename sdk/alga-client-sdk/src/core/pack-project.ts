import { mkdtempSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { ensureDir } from './fs.js';
import { packDir } from './pack.js';

export type PackProjectOptions = { force?: boolean; logger?: { info: Function } };

export async function packProject(projectPath: string, outPath: string, opts: PackProjectOptions = {}) {
  const project = resolve(projectPath);
  const out = resolve(outPath);
  const manifestPath = join(project, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`manifest.json not found in project: ${project}`);

  const stage = mkdtempSync(join(tmpdir(), 'alga-ext-stage-'));
  const entries = ['manifest.json', 'ui', 'artifacts', 'precompiled', 'SIGNATURE', 'sbom.spdx.json'];
  for (const rel of entries) {
    const src = join(project, rel);
    if (existsSync(src)) {
      cpSync(src, join(stage, rel), { recursive: true });
      opts.logger?.info?.(`[pack-project] staged: ${rel}`);
    }
  }

  ensureDir(dirname(out));
  return await packDir(stage, out, { force: opts.force, logger: opts.logger as any });
}

