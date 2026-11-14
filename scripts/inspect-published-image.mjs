import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const MAX_ATTEMPTS = 6;
const RETRY_DELAY_MS = 2_000;

export async function inspectPublishedImage(reference, digest, {
  inspect = (image) => spawnSync('docker', ['buildx', 'imagetools', 'inspect', image, '--raw'], {
    encoding: 'utf8',
  }),
  sleep = delay,
} = {}) {
  const image = `${reference}@${digest}`;
  let result;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    result = inspect(image);
    if (result.status === 0) return result.stdout;

    if (attempt < MAX_ATTEMPTS) {
      process.stderr.write(`Registry has not made ${image} visible yet (attempt ${attempt}/${MAX_ATTEMPTS}); retrying.\n`);
      await sleep(RETRY_DELAY_MS);
    }
  }

  if (result.error) throw result.error;
  throw new Error(result.stderr || `Unable to inspect ${image} after ${MAX_ATTEMPTS} attempts`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [, , reference, digest, outputPath] = process.argv;
  if (!reference || !digest || !outputPath) {
    process.stderr.write('Usage: inspect-published-image.mjs <reference> <digest> <output-path>\n');
    process.exitCode = 2;
  } else {
    try {
      const manifest = await inspectPublishedImage(reference, digest);
      const { writeFileSync } = await import('node:fs');
      writeFileSync(outputPath, manifest);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  }
}
