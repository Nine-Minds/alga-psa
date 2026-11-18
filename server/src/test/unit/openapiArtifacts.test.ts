import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { writeDocument } from '../../../../sdk/scripts/lib/write-openapi-document.mjs';

describe('OpenAPI artifact serialization', () => {
  const directories: string[] = [];
  const temporaryDirectory = () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openapi-artifacts-'));
    directories.push(directory);
    return directory;
  };

  afterEach(() => {
    directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }));
  });

  it('writes identical artifacts for shared and copied schema objects', () => {
    const maintenanceTypes = ['preventive', 'corrective', 'inspection'];
    const frequency = { type: 'string', enum: ['daily', 'weekly', 'monthly'] };
    const document = {
      openapi: '3.0.3',
      components: {
        schemas: {
          CreateSchedule: { properties: { maintenance_type: { enum: maintenanceTypes }, frequency } },
          UpdateSchedule: { properties: { maintenance_type: { enum: maintenanceTypes }, frequency } },
        },
      },
    };
    const copiedDocument = JSON.parse(JSON.stringify(document));
    const sharedDir = temporaryDirectory();
    const copiedDir = temporaryDirectory();

    for (const [directory, value] of [[sharedDir, document], [copiedDir, copiedDocument]] as const) {
      expect(writeDocument(directory, 'openapi', ['json', 'yaml'], value)).toEqual([
        path.join(directory, 'openapi.json'),
        path.join(directory, 'openapi.yaml'),
      ]);
      const json = JSON.parse(fs.readFileSync(path.join(directory, 'openapi.json'), 'utf8'));
      const yaml = YAML.parse(fs.readFileSync(path.join(directory, 'openapi.yaml'), 'utf8'));
      expect(json).toEqual(document);
      expect(yaml).toEqual(json);
    }

    for (const format of ['json', 'yaml']) {
      expect(fs.readFileSync(path.join(sharedDir, `openapi.${format}`), 'utf8')).toBe(
        fs.readFileSync(path.join(copiedDir, `openapi.${format}`), 'utf8'),
      );
    }
  });
});
