import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Regression fence: a client portal component may only render text that a server action
// explicitly classified as user-safe (a returned action/permission error payload, or a
// UserFacingError). The message of an arbitrary caught error can carry driver or stack
// detail, so components must use `userFacingErrorMessage(error, <localized fallback>)`.

const componentsDir = __dirname;

const listSources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSources(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });

const offendingLines = (pattern: RegExp, allow?: RegExp) =>
  listSources(componentsDir).flatMap((file) =>
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .map((line, index) => ({ line, location: `${path.relative(componentsDir, file)}:${index + 1}` }))
      .filter(({ line }) => pattern.test(line) && !(allow && allow.test(line)))
      .map(({ location, line }) => `${location}: ${line.trim()}`),
  );

describe('client portal components do not render raw caught-error text', () => {
  it('never passes a caught error to getErrorMessage', () => {
    expect(offendingLines(/getErrorMessage\(\s*(e|err|error)\s*\)/)).toEqual([]);
  });

  it('never reads .message from a caught error, except from a UserFacingError or to match a known code', () => {
    expect(
      offendingLines(/\b(e|err|error)\.message\b/, /UserFacingError|\.message\.includes\(/),
    ).toEqual([]);
  });
});
