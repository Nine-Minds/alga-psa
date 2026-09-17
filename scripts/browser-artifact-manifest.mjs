import { readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createBrowserArchiveReceipt, buildBrowserArtifactManifest } from './lib/browser-artifact-manifest.mjs';
const read = async file => JSON.parse(await readFile(file, 'utf8'));
const [mode, inputPath, outputPath, recordPath, service] = process.argv.slice(2);
let protectedOutput = Boolean(outputPath && [inputPath, recordPath].filter(Boolean)
  .some(file => path.resolve(file) === path.resolve(outputPath)));
try {
  if (!outputPath || !['archive', 'manifest'].includes(mode)
    || (mode === 'archive' ? process.argv.length !== 7 : process.argv.length !== 5)
    || [inputPath, recordPath].filter(Boolean).some(file => path.resolve(file) === path.resolve(outputPath))) throw Error('Invalid arguments');
  const context = { revision: process.env.GITHUB_SHA, edition: process.env.E2E_EDITION,
    runId: process.env.GITHUB_RUN_ID, runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT) };
  let result;
  if (mode === 'archive') {
    const record = await read(recordPath);
    if (record.service !== service) throw Error('Service mismatch');
    result = await createBrowserArchiveReceipt(record, inputPath, context);
  } else {
    const entries = await read(inputPath);
    if (Array.isArray(entries)) protectedOutput ||= entries.some(entry => ['record', 'receipt', 'inspection'].some(key =>
      typeof entry?.[key] === 'string' && path.resolve(entry[key]) === path.resolve(outputPath)));
    if (!Array.isArray(entries) || protectedOutput || entries.some(entry => ['record', 'receipt', 'inspection'].some(key =>
      typeof entry?.[key] !== 'string'))) throw Error('Invalid manifest inputs');
    const components = await Promise.all(entries.map(async entry => ({ record: await read(entry.record),
      receipt: await read(entry.receipt), inspection: await read(entry.inspection) })));
    result = buildBrowserArtifactManifest({ ...context, components });
  }
  await rm(outputPath, { force: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
} catch {
  if (outputPath && !protectedOutput) await rm(outputPath, { force: true }).catch(() => {});
  console.error('Browser CI artifact evidence verification failed');
  process.exitCode = 1;
}
