import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type FeatureEntry = {
  id: string;
  description: string;
};

type TestEntry = {
  id: string;
  description: string;
  featureIds?: string[];
};

const thisFile = fileURLToPath(import.meta.url);
const thisDir = path.dirname(thisFile);
const repoRoot = path.resolve(thisDir, '../../../../../');
const planRoot = path.resolve(
  repoRoot,
  'ee/docs/plans/2026-03-04-invoice-workflow-expression-unification'
);

const readPlanJson = <T,>(relativeFile: string): T => {
  const absolutePath = path.resolve(planRoot, relativeFile);
  const content = readFileSync(absolutePath, 'utf8');
  return JSON.parse(content) as T;
};

describe('plan feature/test traceability', () => {
  it('ensures every feature has at least one mapped test reference', () => {
    const features = readPlanJson<FeatureEntry[]>('features.json');
    const tests = readPlanJson<TestEntry[]>('tests.json');

    const featureIds = new Set(features.map((feature) => feature.id));
    const mappedFeatureIds = new Set(
      tests.flatMap((testItem) => testItem.featureIds ?? []).filter((featureId) => /^F\d{3}$/.test(featureId))
    );

    const unknownFeatureReferences = [...mappedFeatureIds].filter((featureId) => !featureIds.has(featureId));
    const missingFeatureMappings = [...featureIds].filter((featureId) => !mappedFeatureIds.has(featureId));

    expect(unknownFeatureReferences).toEqual([]);
    expect(missingFeatureMappings).toEqual([]);
  });
});

