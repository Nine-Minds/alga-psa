import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../../../../');
const componentPath = 'server/src/components/co-managed/CoManagedProjectTaskAssignment.tsx';
const locales = fs
  .readdirSync(path.join(root, 'server/public/locales'))
  .filter((entry) => fs.existsSync(path.join(root, 'server/public/locales', entry, 'msp/licensing.json')));

describe('co-managed task assignment translations', () => {
  it('defines every referenced sharedTasks key in every locale, including the redacted-assignee label', () => {
    const source = fs.readFileSync(path.join(root, componentPath), 'utf8');
    const keys = new Set<string>();
    for (const match of source.matchAll(/t\(['"`]coManaged\.sharedTasks\.([A-Za-z0-9_$]+)['"`]/g)) keys.add(match[1]);
    expect(keys).toContain('assignedHidden');
    expect(locales).toEqual(expect.arrayContaining(['en', 'de', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'sv', 'xx', 'yy']));

    for (const locale of locales) {
      const file = path.join(root, `server/public/locales/${locale}/msp/licensing.json`);
      const sharedTasks = JSON.parse(fs.readFileSync(file, 'utf8')).coManaged.sharedTasks;
      for (const key of keys) expect(sharedTasks[key], `${locale}: ${key}`).toBeTruthy();
      expect(sharedTasks.assignedTo, `${locale}: assignedTo`).toContain('{{name}}');
      expect(sharedTasks.assignedHidden, `${locale}: assignedHidden`).not.toContain('{{name}}');
    }
  });
});
