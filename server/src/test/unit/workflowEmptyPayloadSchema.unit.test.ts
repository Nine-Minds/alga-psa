import { beforeEach, describe, expect, it } from 'vitest';

import {
  EMPTY_WORKFLOW_PAYLOAD_SCHEMA_REF,
  getSchemaRegistry,
  initializeWorkflowRuntimeV2
} from '@alga-psa/workflows/runtime';

describe('workflow empty payload schema', () => {
  beforeEach(() => {
    initializeWorkflowRuntimeV2();
  });

  it('registers the empty payload schema and accepts an empty object payload', () => {
    const registry = getSchemaRegistry();

    expect(registry.has(EMPTY_WORKFLOW_PAYLOAD_SCHEMA_REF)).toBe(true);
    expect(registry.get(EMPTY_WORKFLOW_PAYLOAD_SCHEMA_REF).safeParse({}).success).toBe(true);
  });

  it('rejects extra fields for the empty payload schema', () => {
    const registry = getSchemaRegistry();

    expect(registry.get(EMPTY_WORKFLOW_PAYLOAD_SCHEMA_REF).safeParse({ unexpected: true }).success).toBe(false);
  });
});
