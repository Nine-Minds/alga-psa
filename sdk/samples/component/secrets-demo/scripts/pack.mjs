import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compress } from '@mongodb-js/zstd';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectPath = resolve(__dirname, '..');
const outFile = '/tmp/secrets-demo-bundle.tar.zst';
const tempTarFile = join(projectPath, 'tmp/secrets-demo-bundle.tar');

// Ensure tmp dir exists
const tmpDir = join(projectPath, 'tmp');
if (!existsSync(tmpDir)) {
  mkdirSync(tmpDir, { recursive: true });
}

(async () => {
  try {
    console.log('[pack] Creating tar archive...');

    // Create tar file with required files
    execSync(`cd ${projectPath} && tar -cvf ${tempTarFile} manifest.json ui dist/main.wasm`, {
      stdio: 'inherit'
    });

    console.log('[pack] Reading tar file...');
    const tarData = readFileSync(tempTarFile);

    console.log('[pack] Compressing with zstd...');
    const compressed = await compress(tarData);

    console.log('[pack] Writing output file...');
    writeFileSync(outFile, compressed);

    // Calculate SHA256
    const hash = createHash('sha256').update(compressed).digest('hex');
    writeFileSync(outFile + '.sha256', hash);

    // Cleanup
    unlinkSync(tempTarFile);

    console.log(`✓ Successfully packed extension`);
    console.log(`  Output: ${outFile}`);
    console.log(`  SHA256: ${hash}`);
  } catch (error) {
    console.error('✗ Failed to pack extension');
    console.error(error.message);
    process.exit(1);
  }
})();
