import { statSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import { ensureDir } from './fs.js';

export type PackOptions = {
  /** Directory to archive. Defaults to `process.cwd()` */
  entry?: string;
  /** Output directory. Defaults to `<entry>/dist` */
  outDir?: string;
  /** Output filename. Defaults to `bundle.tar.zst` */
  outFileName?: string;
  /** Overwrite existing output file */
  force?: boolean;
  logger?: { info: Function; warn: Function };
};

export interface PackResult {
  outFile: string;
  sha256: string;
  sidecarPath: string;
  size?: number;
}

function which(bin: string): boolean {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' });
  return result.status === 0;
}

export async function pack(opts: PackOptions = {}): Promise<PackResult> {
  const entry = resolve(opts.entry || process.cwd());
  const outDir = resolve(opts.outDir || join(entry, 'dist'));
  const outFileName = opts.outFileName || 'bundle.tar.zst';
  const outFile = join(outDir, outFileName);
  ensureDir(dirname(outFile));

  const logger = opts.logger || console;
  if (!which('tar') || !which('zstd')) {
    logger.warn('[pack] tar or zstd not found on PATH.');
    throw new Error('Missing required system tools: tar and zstd');
  }

  // Build tar | zstd pipeline
  const entries = readdirSync(entry, { withFileTypes: true })
    .map((d) => d.name)
    .filter((n) => n !== '.' && n !== '..');
  if (entries.length === 0) throw new Error('Input directory has no files to pack');

  const tarArgs = ['-C', entry, '-cf', '-', ...entries];
  const tarProc = spawn('tar', tarArgs, { stdio: ['ignore', 'pipe', 'inherit'] });
  const zstdArgs = ['-19', '-T0', ...(opts.force ? ['-f'] : []), '-o', outFile];
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

  const data = readFileSync(outFile);
  const h = createHash('sha256');
  h.update(data);
  const hashHex = h.digest('hex');
  const sidecarPath = join(dirname(outFile), outFileName === 'bundle.tar.zst' ? 'bundle.sha256' : `${outFileName}.sha256`);
  await fsWriteText(sidecarPath, `${hashHex}\n`);
  logger.info(`sha256:${hashHex}  ${outFile}`);
  logger.info(`[pack] wrote sidecar: ${sidecarPath}`);

  let size: number | undefined;
  try { size = statSync(outFile).size; } catch {}
  return { outFile, sha256: hashHex, sidecarPath, size };
}

async function fsWriteText(path: string, text: string) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, text, { encoding: 'utf8', flag: 'w' });
}
