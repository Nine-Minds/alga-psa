const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const zstd = require('@mongodb-js/zstd');
const crypto = require('crypto');

const projectPath = path.join(__dirname, 'sdk/samples/component/secrets-demo');
const outFile = '/tmp/secrets-demo-bundle.tar.zst';
const tempTarFile = path.join(__dirname, 'tmp/secrets-demo-bundle.tar');

// Ensure tmp dir exists
const tmpDir = path.join(__dirname, 'tmp');
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

(async () => {
  try {
    console.log('[pack] Creating tar archive...');

    // Create tar file with required files
    execSync(`cd ${projectPath} && tar -cvf ${tempTarFile} manifest.json ui dist/main.wasm`, {
      stdio: 'inherit'
    });

    console.log('[pack] Reading tar file...');
    const tarData = fs.readFileSync(tempTarFile);

    console.log('[pack] Compressing with zstd...');
    const compressed = await zstd.compress(tarData);

    console.log('[pack] Writing output file...');
    fs.writeFileSync(outFile, compressed);

    // Calculate SHA256
    const hash = crypto.createHash('sha256').update(compressed).digest('hex');
    fs.writeFileSync(outFile + '.sha256', hash);

    // Cleanup
    fs.unlinkSync(tempTarFile);

    console.log(`✓ Successfully packed extension`);
    console.log(`  Output: ${outFile}`);
    console.log(`  SHA256: ${hash}`);
  } catch (error) {
    console.error('✗ Failed to pack extension');
    console.error(error.message);
    process.exit(1);
  }
})();
