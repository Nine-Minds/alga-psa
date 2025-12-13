const zstd = require('@mongodb-js/zstd');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

(async () => {
  try {
    console.log('[inspect] Reading compressed bundle...');
    const compressed = fs.readFileSync('/tmp/secrets-demo-bundle.tar.zst');

    console.log('[inspect] Decompressing with zstd...');
    const decompressed = await zstd.decompress(compressed);

    console.log('[inspect] Writing to temporary tar...');
    const tempTar = '/tmp/inspect-bundle.tar';
    fs.writeFileSync(tempTar, decompressed);

    console.log('[inspect] Extracting tar contents...');
    execSync(`cd /tmp/inspect-extract && tar -xf ${tempTar}`, {
      stdio: 'inherit',
      cwd: '/tmp/inspect-extract'
    });

    console.log('\n[inspect] Bundle contents:');
    execSync(`find /tmp/inspect-extract -type f | sort`, { stdio: 'inherit' });

    // Now show the actual UI code
    console.log('\n\n========== UI/MAIN.JS FROM BUNDLE ==========');
    const uiContent = fs.readFileSync('/tmp/inspect-extract/ui/main.js', 'utf8');
    console.log(uiContent);

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
