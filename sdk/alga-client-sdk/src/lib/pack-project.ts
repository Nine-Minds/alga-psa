import { mkdtempSync, cpSync, existsSync, readFileSync } from 'node:fs';
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
  logger?: { info: (...args: unknown[]) => void };
}

interface ManifestJson {
  runtime?: string;
  api?: {
    endpoints?: Array<{ handler?: string }>;
  };
}

export async function packProject(opts: PackProjectOptions = {}): Promise<string> {
  const project = resolve(opts.projectPath || process.cwd());
  const outFile = resolve(opts.outFile || join(project, 'dist', 'bundle.tar.zst'));
  const manifestPath = join(project, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`manifest.json not found in project: ${project}`);

  // Read manifest to determine if WASM is required
  let manifest: ManifestJson;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch (err) {
    throw new Error(`Failed to parse manifest.json: ${err}`);
  }

  const hasApiEndpoints = manifest.api?.endpoints && manifest.api.endpoints.length > 0;
  const isWasmRuntime = manifest.runtime?.startsWith('wasm');
  const needsWasm = hasApiEndpoints || isWasmRuntime;

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

  // Look for WASM in multiple locations (support both naming conventions)
  const mainWasm = join(project, 'dist', 'main.wasm');
  const componentWasm = join(project, 'dist', 'component.wasm');
  const wasmPath = existsSync(mainWasm) ? mainWasm : existsSync(componentWasm) ? componentWasm : null;

  if (needsWasm && !wasmPath) {
    throw new Error(`WASM file not found (expected dist/main.wasm or dist/component.wasm) in project: ${project}`);
  }

  if (wasmPath) {
    const componentMeta = join(project, 'dist', 'component.json');

    // Stage to artifacts/component for backwards compatibility
    const componentDestDir = join(stage, 'artifacts', 'component');
    ensureDir(componentDestDir);
    cpSync(wasmPath, join(componentDestDir, 'component.wasm'));
    if (existsSync(componentMeta)) {
      cpSync(componentMeta, join(componentDestDir, 'component.json'));
    }

    // Stage to dist/main.wasm (runner's expected location)
    const distDir = join(stage, 'dist');
    ensureDir(distDir);
    cpSync(wasmPath, join(distDir, 'main.wasm'));
    if (existsSync(componentMeta)) {
      cpSync(componentMeta, join(distDir, 'component.json'));
    }

    opts.logger?.info?.('[pack-project] staged: dist/main.wasm');
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
