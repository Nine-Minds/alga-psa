import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  partitionStepExpressionValidations,
  validateStepExpressions,
  type StepExpressionValidation,
} from '../expressionValidation';

describe('workflow step expression validation wiring', () => {
  it('does not rely on removed legacy path scanner helpers in WorkflowDesigner', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../WorkflowDesigner.tsx'), 'utf8');
    expect(source.includes('extractExpressionPaths')).toBe(false);
    expect(source.includes('validateExpressionPath')).toBe(false);
  });

  it('T284: preserves shared diagnostics for non-inputMapping expressions after the inline editor refactor', () => {
    const validations = validateStepExpressions(
      {
        customConfig: {
          customerId: { $expr: 'unknown.root' },
          existingId: { $expr: 'vars.previous.id' },
          missingId: { $expr: 'vars.missing.id' },
        },
      },
      {
        payloadSchema: {
          type: 'object',
          properties: {
            payloadId: { type: 'string' },
          },
        },
        steps: [
          {
            saveAs: 'previous',
            outputSchema: {
              type: 'object',
              properties: {
                id: { type: 'string' },
              },
            },
          },
        ],
      }
    );

    const diagnosticPaths = validations.map((validation) => validation.diagnostic.path);
    expect(diagnosticPaths).toContain('unknown.root');
    expect(diagnosticPaths).toContain('vars.missing.id');
    expect(diagnosticPaths).not.toContain('vars.previous.id');
  });

  it('skips diagnostics for structured input mappings', () => {
    const validations = validateStepExpressions(
      {
        inputMapping: {
          text: { $expr: 'vars.contactsFindResult.contact.email' },
          missing: { $expr: 'vars.missing.id' },
        },
      },
      {
        payloadSchema: {
          type: 'object',
          properties: {
            payloadId: { type: 'string' },
          },
        },
        steps: [
          {
            saveAs: 'contactsFindResult',
            outputSchema: {
              type: 'object',
              properties: {
                contact: {
                  type: 'object',
                  properties: {
                    email: { type: 'string' },
                  },
                },
              },
            },
          },
        ],
      }
    );

    expect(validations).toEqual([]);
  });

  it('partitions shared diagnostics by severity for panel rendering', () => {
    const validations: StepExpressionValidation[] = [
      {
        field: 'config.a',
        diagnostic: {
          severity: 'error',
          message: 'bad expression',
          code: 'syntax-error',
          source: 'shared-path-validation:expression',
        },
      },
      {
        field: 'config.b',
        diagnostic: {
          severity: 'warning',
          message: 'deprecated function',
          code: 'deprecated-function',
          source: 'shared-path-validation:expression',
        },
      },
      {
        field: 'config.c',
        diagnostic: {
          severity: 'info',
          message: 'unknown path',
          code: 'unknown-path',
          source: 'shared-path-validation:expression',
        },
      },
    ];

    const groups = partitionStepExpressionValidations(validations);
    expect(groups.errors.map((entry) => entry.field)).toEqual(['config.a']);
    expect(groups.warnings.map((entry) => entry.field)).toEqual(['config.b']);
    expect(groups.info.map((entry) => entry.field)).toEqual(['config.c']);
  });
});
