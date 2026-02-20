import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '..');
const sourceRoot = path.join(repoRoot, 'server/public/locales/en');

const parseArgs = (argv: string[]) => {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key.startsWith('--')) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${key}`);
      }
      args.set(key, value);
      i += 1;
    }
  }
  return args;
};

const extractVariables = (value: string): string[] => {
  const matches = value.match(/\{\{\s*[^}]+\s*\}\}/g);
  return matches ? matches.map((match) => match.trim()) : [];
};

const replaceLeafStrings = (input: unknown, fill: string): unknown => {
  if (typeof input === 'string') {
    const variables = extractVariables(input);
    if (variables.length === 0) {
      return fill;
    }
    return `${fill} ${variables.join(' ')} ${fill}`.trim();
  }

  if (Array.isArray(input)) {
    return input.map((value) => replaceLeafStrings(value, fill));
  }

  if (input && typeof input === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      result[key] = replaceLeafStrings(value, fill);
    }
    return result;
  }

  return input;
};

const collectJsonFiles = async (dir: string): Promise<string[]> => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectJsonFiles(fullPath);
      results.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      results.push(fullPath);
    }
  }

  return results;
};

const ensureDir = async (dir: string) => {
  await fs.mkdir(dir, { recursive: true });
};

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  const locale = args.get('--locale');
  const fill = args.get('--fill');

  if (!locale || !fill) {
    console.error('Usage: npx ts-node scripts/generate-pseudo-locale.ts --locale <code> --fill <string>');
    process.exit(1);
  }

  const files = await collectJsonFiles(sourceRoot);
  const targetRoot = path.join(repoRoot, 'server/public/locales', locale);

  for (const filePath of files) {
    const relativePath = path.relative(sourceRoot, filePath);
    const targetPath = path.join(targetRoot, relativePath);
    const targetDir = path.dirname(targetPath);

    const raw = await fs.readFile(filePath, 'utf8');
    const json = JSON.parse(raw) as unknown;
    const transformed = replaceLeafStrings(json, fill);

    await ensureDir(targetDir);
    await fs.writeFile(targetPath, `${JSON.stringify(transformed, null, 2)}\n`, 'utf8');
  }

  console.log(`Generated pseudo-locale ${locale} at ${targetRoot}`);
};

run().catch((error) => {
  console.error('Failed to generate pseudo-locale:', error);
  process.exit(1);
});
