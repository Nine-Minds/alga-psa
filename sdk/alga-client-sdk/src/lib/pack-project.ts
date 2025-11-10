import { mkdtempSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { ensureDir } from './fs.js';
import { pack } from './pack.js';

export interface PackProjectOptions {
  /** Project root. Defaults to `process.cwd()` */
  projectPath?: string;
  /** Explicit output file path. Defaults to `<project>/dist/bundle.tar.zst` */
  outFile?: string;
  force?: boolean;
  logger?: { info: Function };
}

export async function packProject(opts: PackProjectOptions = {}): Promise<string> {
  const project = resolve(opts.projectPath || process.cwd());
  const outFile = resolve(opts.outFile || join(project, 'dist', 'bundle.tar.zst'));
  const manifestPath = join(project, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`manifest.json not found in project: ${project}`);

  const stage = mkdtempSync(join(tmpdir(), 'alga-ext-stage-'));
  const entries = ['manifest.json', 'ui', 'artifacts', 'precompiled', 'SIGNATURE', 'sbom.spdx.json'];
  for (const rel of entries) {
    let src = join(project, rel);
    // Prefer built UI from dist/ui if present, but stage it under 'ui/'
    if (rel === 'ui') {
      const builtUi = join(project, 'dist', 'ui');
      if (existsSync(builtUi)) {
        src = builtUi;
      }
    }
    if (existsSync(src)) {
      const dest = join(stage, rel);
      cpSync(src, dest, { recursive: true });
      opts.logger?.info?.(`[pack-project] staged: ${rel}`);
    }
  }

  const componentWasm = join(project, 'dist', 'component.wasm');
  if (!existsSync(componentWasm)) {
    throw new Error(`dist/component.wasm not found in project: ${project}`);
  }
  const componentMeta = join(project, 'dist', 'component.json');
  const componentDestDir = join(stage, 'artifacts', 'component');
  ensureDir(componentDestDir);
  cpSync(componentWasm, join(componentDestDir, 'component.wasm'));
  if (existsSync(componentMeta)) {
    cpSync(componentMeta, join(componentDestDir, 'component.json'));
  }

  const distDir = join(stage, 'dist');
  ensureDir(distDir);
  cpSync(componentWasm, join(distDir, 'main.wasm'));
  if (existsSync(componentMeta)) {
    cpSync(componentMeta, join(distDir, 'component.json'));
  }

  const witDir = join(project, 'wit');
  if (existsSync(witDir)) {
    const witDest = join(stage, 'wit');
    cpSync(witDir, witDest, { recursive: true });
    opts.logger?.info?.('[pack-project] staged: wit');
  }

  ensureDir(dirname(outFile));
  const outDir = dirname(outFile);
  const outFileName = outFile.split('/').pop() || 'bundle.tar.zst';
  const res = await pack({ entry: stage, outDir, outFileName, force: opts.force, logger: opts.logger as any });
  return res.outFile;
}
