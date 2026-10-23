import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as packageExports from '@alga-psa/event-schemas';
import { workflowEventPayloadSchemas } from '@alga-psa/event-schemas/schemas/domain/workflowEventPayloadSchemas';
import { getSchemaRegistry } from '../registries/schemaRegistry';
import { initializeWorkflowRuntimeV2 } from '../init';

const repoRoot = path.resolve(__dirname, '../../../..');
const legacySchemaDirs = [
  'shared/workflow/runtime/schemas',
  'ee/packages/workflows/src/runtime/schemas',
];

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

describe('single workflow event schema tree', () => {
  it('leaves no zod schema definitions under the legacy schema directories', () => {
    const offenders: string[] = [];
    for (const rel of legacySchemaDirs) {
      for (const file of listFiles(path.join(repoRoot, rel))) {
        if (!/\.(ts|tsx)$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
        const source = readFileSync(file, 'utf8');
        if (/EventSchemas?\.ts$/.test(file) || /\bz\.(object|string|enum|union|literal|number|array)\b/.test(source)) {
          offenders.push(path.relative(repoRoot, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('exposes workflowEventPayloadSchemas from the package entry point as the same module instance', () => {
    expect(packageExports.workflowEventPayloadSchemas).toBe(workflowEventPayloadSchemas);
  });

  it('registers every payload ref in the runtime schema registry with the package schema instance', () => {
    initializeWorkflowRuntimeV2();
    const registry = getSchemaRegistry();
    const refs = Object.keys(workflowEventPayloadSchemas);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(registry.get(ref), ref).toBe(workflowEventPayloadSchemas[ref]);
    }
  });
});
