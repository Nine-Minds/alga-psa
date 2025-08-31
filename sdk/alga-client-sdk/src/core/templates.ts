import { copyRecursive, ensureDir, readText, writeText } from './fs.js';
import { join, resolve } from 'node:path';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';

type Tokens = Record<string, string>;

function walkCopyWithTokens(srcDir: string, destDir: string, tokens: Tokens) {
  const entries = readdirSync(srcDir, { withFileTypes: true });
  for (const e of entries) {
    const srcPath = join(srcDir, e.name);
    const destPath = join(destDir, e.name.replace(/__PACKAGE_NAME__/g, tokens.PACKAGE_NAME || 'alga-ext'));
    if (e.isDirectory()) {
      ensureDir(destPath);
      walkCopyWithTokens(srcPath, destPath, tokens);
    } else {
      const raw = readText(srcPath);
      const rendered = raw
        .replace(/__PACKAGE_NAME__/g, tokens.PACKAGE_NAME || 'alga-ext')
        .replace(/__DESCRIPTION__/g, tokens.DESCRIPTION || 'Alga extension')
        .replace(/__SDK_VERSION__/g, tokens.SDK_VERSION || '^0.1.0');
      writeText(destPath, rendered);
    }
  }
}

export function scaffoldTemplate(templateRoot: string, destDir: string, tokens: Tokens) {
  const src = resolve(templateRoot);
  const dest = resolve(destDir);
  ensureDir(dest);
  walkCopyWithTokens(src, dest, tokens);
}

