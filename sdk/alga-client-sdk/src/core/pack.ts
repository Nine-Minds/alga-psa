import { statSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, basename, join, resolve } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ensureDir } from './fs.js';

function which(bin: string): boolean {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' });
  return result.status === 0;
}

export type PackOptions = {
  force?: boolean;
  logger?: { info: Function; warn: Function };
};

export async function packDir(inputDir: string, outputPath: string, opts: PackOptions = {}) {
  const force = Boolean(opts.force);
  const logger = opts.logger || console;
  const absInput = resolve(inputDir);
  const absOutput = resolve(outputPath);

  let st: ReturnType<typeof statSync>;
  try { st = statSync(absInput); } catch { throw new Error(`Input directory not found: ${absInput}`); }
  if (!st.isDirectory()) throw new Error(`Input is not a directory: ${absInput}`);

  ensureDir(dirname(absOutput));

  if (!which('tar') || !which('zstd')) {
    logger.warn('[pack] tar or zstd not found on PATH.');
    throw new Error('Missing required system tools: tar and zstd');
  }

  let entries: string[] = [];
  try {
    entries = readdirSync(absInput, { withFileTypes: true })
      .map(d => d.name)
      .filter(n => n !== '.' && n !== '..');
  } catch (e) {
    throw new Error(`Failed to read input directory: ${(e as Error).message}`);
  }
  if (entries.length === 0) throw new Error('Input directory has no files to pack');

  const tarArgs = ['-C', absInput, '-cf', '-', ...entries];
  const tarProc = spawn('tar', tarArgs, { stdio: ['ignore', 'pipe', 'inherit'] });
  const zstdArgs = ['-19', '-T0', ...(force ? ['-f'] : []), '-o', absOutput];
  const zstdProc = spawn('zstd', zstdArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
  tarProc.stdout!.pipe(zstdProc.stdin!);

  await new Promise<void>((resolveWait, rejectWait) => {
    let tarExit: number | null = null;
    let zstdExit: number | null = null;
    const maybe = () => {
      if (tarExit !== null && zstdExit !== null) {
        if (tarExit === 0 && zstdExit === 0) resolveWait();
        else rejectWait(new Error(`Packing failed (tar=${tarExit}, zstd=${zstdExit})`));
      }
    };
    tarProc.on('exit', (c) => { tarExit = c; maybe(); });
    zstdProc.on('exit', (c) => { zstdExit = c; maybe(); });
  });

  const data = readFileSync(absOutput);
  const h = createHash('sha256');
  h.update(data);
  const hashHex = h.digest('hex');
  const base = basename(absOutput);
  const sidecarName = base === 'bundle.tar.zst' ? 'bundle.sha256' : `${base}.sha256`;
  const sidecarPath = join(dirname(absOutput), sidecarName);
  writeFileSync(sidecarPath, `${hashHex}\n`, { encoding: 'utf8', flag: 'w' });
  logger.info(`sha256:${hashHex}  ${absOutput}`);
  logger.info(`[pack] wrote sidecar: ${sidecarPath}`);
  return { outputPath: absOutput, sha256: hashHex, sidecarPath };
}

