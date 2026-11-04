import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * CM L9 grep contract. Client components must reach provider setup through the
 * product-neutral PROVIDER_SETUP_ENTRY_PATH. The PSA integrations URL is a
 * not_found page for a co_managed workspace, so a surviving literal is a dead link.
 */
const LITERAL = '/msp/settings/integrations?category=providers';
const componentsDir = path.resolve(__dirname);

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('provider setup entry path (grep contract)', () => {
  it(`no packages/integrations component contains ${LITERAL}`, () => {
    const files = sourceFiles(componentsDir);
    expect(files.length).toBeGreaterThan(20);
    const offenders = files
      .filter((file) => fs.readFileSync(file, 'utf8').includes(LITERAL))
      .map((file) => path.relative(componentsDir, file));
    expect(offenders).toEqual([]);
  });

  it('the three Open Providers links use PROVIDER_SETUP_ENTRY_PATH', () => {
    const count = (file: string) =>
      (fs.readFileSync(path.join(componentsDir, file), 'utf8').match(/window\.location\.assign\(PROVIDER_SETUP_ENTRY_PATH\)/g) ?? []).length;
    expect(count('email/EmailProviderConfiguration.tsx')).toBe(1);
    expect(count('email/MicrosoftProviderForm.tsx')).toBe(2);
  });
});
