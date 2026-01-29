import fs from 'node:fs/promises';
import path from 'node:path';

const nextDir = process.argv[2] ?? 'server/.next';
const serverOutputDir = path.join(nextDir, 'server');

const needles = [
  'Workflow designer requires Enterprise Edition. Please upgrade to access this feature.',
];

async function walkFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

async function main() {
  try {
    await fs.access(serverOutputDir);
  } catch {
    console.error(`[workflows-ee-guard] Missing Next output directory: ${serverOutputDir}`);
    console.error(`[workflows-ee-guard] Run an EE build first (e.g. in server/: EDITION=ee NEXT_PUBLIC_EDITION=enterprise next build).`);
    process.exit(2);
  }

  const files = await walkFiles(serverOutputDir);
  for (const filePath of files) {
    let contents;
    try {
      contents = await fs.readFile(filePath, 'utf8');
    } catch {
      continue;
    }

    for (const needle of needles) {
      if (contents.includes(needle)) {
        console.error('[workflows-ee-guard] Found CE/OSS workflows stub string in EE build output.');
        console.error(`[workflows-ee-guard] needle: ${JSON.stringify(needle)}`);
        console.error(`[workflows-ee-guard] file: ${filePath}`);
        process.exit(1);
      }
    }
  }

  console.log('[workflows-ee-guard] OK: no CE/OSS workflows stub strings found in .next/server output.');
}

await main();

