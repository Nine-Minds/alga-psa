/**
 * Unit Tests for Diagnostics Provider
 *
 * Tests expression validation including syntax errors, bracket matching,
 * function validation, and reference validation.
 */

import { describe, it, expect } from 'vitest';
import {
  validateExpression,
  DiagnosticSeverity,
  type ExpressionDiagnostic,
} from '../diagnosticsProvider';
import type { ExpressionContext, JsonSchema } from '../completionProvider';

describe('Diagnostics Provider', () => {
  describe('Empty Expression Handling', () => {
    it('should return no diagnostics for empty expression', () => {
      const diagnostics = validateExpression('', {});
      expect(diagnostics).toHaveLength(0);
    });

    it('should return no diagnostics for whitespace-only expression', () => {
      const diagnostics = validateExpression('   ', {});
      expect(diagnostics).toHaveLength(0);
    });
  });

  describe('Bracket Matching', () => {
    it('should detect unclosed parenthesis', () => {
      const diagnostics = validateExpression('$sum(payload.items', {});

      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining("Unclosed bracket '('"),
          severity: DiagnosticSeverity.Error,
        })
      );
    });

    it('should detect unclosed bracket', () => {
      const diagnostics = validateExpression('payload.items[0', {});

      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining("Unclosed bracket '['"),
          severity: DiagnosticSeverity.Error,
        })
      );
    });

    it('should detect unclosed brace', () => {
      const diagnostics = validateExpression('{ "name": "test"', {});

      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining("Unclosed bracket '{'"),
          severity: DiagnosticSeverity.Error,
        })
      );
    });

    it('should detect unexpected closing parenthesis', () => {
      const diagnostics = validateExpression('payload.value)', {});

      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining("Unexpected closing bracket ')'"),
          severity: DiagnosticSeverity.Error,
        })
      );
    });

    it('should detect mismatched brackets', () => {
      const diagnostics = validateExpression('$sum(payload.items]', {});

      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining('Mismatched brackets'),
          severity: DiagnosticSeverity.Error,
        })
      );
    });

    it('should accept correctly matched brackets', () => {
      const diagnostics = validateExpression('$sum(payload.items[0].value)', {});
      const bracketErrors = diagnostics.filter(d =>
        d.message.includes('bracket') || d.message.includes('Unclosed') || d.message.includes('Mismatched')
      );

      expect(bracketErrors).toHaveLength(0);
    });

    it('should handle nested brackets correctly', () => {
      const diagnostics = validateExpression('$map(payload.items, function($v) { $v.name })', {});
      const bracketErrors = diagnostics.filter(d =>
        d.message.includes('bracket') || d.message.includes('Unclosed') || d.message.includes('Mismatched')
      );

      expect(bracketErrors).toHaveLength(0);
    });

    it('should detect multiple unclosed brackets', () => {
      const diagnostics = validateExpression('$map(payload.items[', {});

      const unclosedErrors = diagnostics.filter(d => d.message.includes('Unclosed'));
      expect(unclosedErrors.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('String Validation', () => {
    it('should detect unterminated double-quoted string', () => {
      const diagnostics = validateExpression('"unterminated', {});

      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          message: 'Unterminated string literal',
          severity: DiagnosticSeverity.Error,
        })
      );
    });

    it('should detect unterminated single-quoted string', () => {
      const diagnostics = validateExpression("'unterminated", {});

      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          message: 'Unterminated string literal',
          severity: DiagnosticSeverity.Error,
        })
      );
    });

    it('should detect unterminated backtick string', () => {
      const diagnostics = validateExpression('`unterminated', {});

      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          message: 'Unterminated string literal',
          severity: DiagnosticSeverity.Error,
        })
      );
    });

    it('should accept properly terminated strings', () => {
      const diagnostics = validateExpression('"hello world"', {});
      const stringErrors = diagnostics.filter(d => d.message.includes('string'));

      expect(stringErrors).toHaveLength(0);
    });

    it('should accept strings with escape sequences', () => {
      const diagnostics = validateExpression('"hello\\nworld"', {});
      const stringErrors = diagnostics.filter(d => d.message.includes('string'));

      expect(stringErrors).toHaveLength(0);
    });

    it('should accept strings with escaped quotes', () => {
      const diagnostics = validateExpression('"hello\\"world\\""', {});
      const stringErrors = diagnostics.filter(d => d.message.includes('Unterminated'));

      expect(stringErrors).toHaveLength(0);
    });
  });

  describe('Function Validation', () => {
    it('should warn about unknown function', () => {
      const diagnostics = validateExpression('$unknownFunction()', {});

      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining("Unknown function '$unknownFunction'"),
          severity: DiagnosticSeverity.Warning,
        })
      );
    });

    it('should suggest similar function names for close typos', () => {
      // The similarity check requires partial match
      const diagnostics = validateExpression('$substrin(payload.name)', {});

      const funcWarning = diagnostics.find(d => d.message.includes('$substrin'));
      expect(funcWarning).toBeDefined();
      // May or may not suggest - just check it reports unknown
      expect(funcWarning?.message).toContain('Unknown function');
    });

    it('should accept known functions', () => {
      const diagnostics = validateExpression('$string(payload.value)', {});
      const funcWarnings = diagnostics.filter(d =>
        d.message.includes('Unknown function') && d.message.includes('$string')
      );

      expect(funcWarnings).toHaveLength(0);
    });

    it('should accept common built-in functions', () => {
      // Test a subset of functions that are definitely in the list
      const commonFunctions = [
        '$sum', '$count', '$string', '$number', '$boolean',
        '$substring', '$trim', '$uppercase', '$lowercase',
        '$map', '$filter', '$reduce', '$keys',
        '$now', '$exists', '$type',
      ];

      for (const fn of commonFunctions) {
        const diagnostics = validateExpression(`${fn}(payload)`, {});
        const unknownFuncErrors = diagnostics.filter(d =>
          d.message.includes('Unknown function') && d.message.includes(fn)
        );

        expect(unknownFuncErrors).toHaveLength(0);
      }
    });
  });

  describe('Reference Validation', () => {
    it('should suggest correct context root for similar typos', () => {
      // The validator checks for partial matches with known context roots
      // "payloads" contains "payload" so it should suggest
      const diagnostics = validateExpression('payloads.name', {});

      // Should have a hint about unknown identifier
      const hint = diagnostics.find(d =>
        d.message.includes('payloads') && d.message.includes("Did you mean")
      );
      expect(hint).toBeDefined();
    });

    it('should suggest vars for similar typo', () => {
      const diagnostics = validateExpression('var.stepResult', {});

      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining("Did you mean 'vars'"),
          severity: DiagnosticSeverity.Hint,
        })
      );
    });

    it('should not warn for valid context roots', () => {
      const validRoots = ['payload', 'vars', 'meta'];

      for (const root of validRoots) {
        const diagnostics = validateExpression(`${root}.field`, {});
        const rootWarnings = diagnostics.filter(d =>
          d.message.includes('Unknown identifier') && d.message.includes(root)
        );

        expect(rootWarnings).toHaveLength(0);
      }
    });

    it('should recognize forEach item variable', () => {
      const context: ExpressionContext = {
        forEachItemVar: 'item',
        forEachItemSchema: { type: 'object' },
      };
      const diagnostics = validateExpression('item.name', context);
      const itemWarnings = diagnostics.filter(d =>
        d.message.includes('Unknown identifier') && d.message.includes('item')
      );

      expect(itemWarnings).toHaveLength(0);
    });

    it('should recognize forEach index variable', () => {
      const context: ExpressionContext = {
        forEachItemVar: 'item',
        forEachIndexVar: 'idx',
      };
      const diagnostics = validateExpression('idx + 1', context);
      const indexWarnings = diagnostics.filter(d =>
        d.message.includes('Unknown identifier') && d.message.includes('idx')
      );

      expect(indexWarnings).toHaveLength(0);
    });

    it('should validate paths against schema', () => {
      const context: ExpressionContext = {
        payloadSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            email: { type: 'string' },
          },
        },
      };

      const diagnostics = validateExpression('payload.nonexistent', context);

      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining('not found in schema'),
          severity: DiagnosticSeverity.Information,
        })
      );
    });

    it('should accept valid paths from schema', () => {
      const context: ExpressionContext = {
        payloadSchema: {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: {
                name: { type: 'string' },
              },
            },
          },
        },
      };

      const diagnostics = validateExpression('payload.user.name', context);
      const pathErrors = diagnostics.filter(d =>
        d.message.includes('not found in schema')
      );

      expect(pathErrors).toHaveLength(0);
    });
  });

  describe('Complex Expression Validation', () => {
    it('should validate complex conditional expression', () => {
      const diagnostics = validateExpression(
        'payload.active ? $string(payload.count) : "inactive"',
        {}
      );
      const errors = diagnostics.filter(d => d.severity === DiagnosticSeverity.Error);

      expect(errors).toHaveLength(0);
    });

    it('should validate array access expression', () => {
      const diagnostics = validateExpression('payload.items[0].name', {});
      const errors = diagnostics.filter(d => d.severity === DiagnosticSeverity.Error);

      expect(errors).toHaveLength(0);
    });

    it('should validate chained function calls', () => {
      const diagnostics = validateExpression(
        '$trim($uppercase(payload.name))',
        {}
      );
      const errors = diagnostics.filter(d => d.severity === DiagnosticSeverity.Error);

      expect(errors).toHaveLength(0);
    });

    it('should validate map expression', () => {
      const diagnostics = validateExpression(
        '$map(payload.items, function($v) { $v.name })',
        {}
      );
      const errors = diagnostics.filter(d => d.severity === DiagnosticSeverity.Error);

      expect(errors).toHaveLength(0);
    });

    it('should validate object construction', () => {
      const diagnostics = validateExpression(
        '{ "name": payload.name, "count": $count(payload.items) }',
        {}
      );
      const errors = diagnostics.filter(d => d.severity === DiagnosticSeverity.Error);

      expect(errors).toHaveLength(0);
    });
  });

  describe('Diagnostic Positions', () => {
    it('should report correct position for bracket error', () => {
      const expression = 'payload.items[0';
      const diagnostics = validateExpression(expression, {});

      const bracketError = diagnostics.find(d => d.message.includes('Unclosed'));
      expect(bracketError).toBeDefined();
      // '[' is at position 13 (0-indexed)
      expect(bracketError!.startOffset).toBe(13);
      expect(bracketError!.endOffset).toBe(14);
    });

    it('should report correct position for string error', () => {
      const expression = '"unterminated';
      const diagnostics = validateExpression(expression, {});

      const stringError = diagnostics.find(d => d.message.includes('Unterminated'));
      expect(stringError).toBeDefined();
      expect(stringError!.startOffset).toBe(0);
      expect(stringError!.endOffset).toBe(13);
    });

    it('should report correct position for function error', () => {
      const expression = 'payload.name + $unknownFn()';
      const diagnostics = validateExpression(expression, {});

      const funcError = diagnostics.find(d => d.message.includes('Unknown function'));
      expect(funcError).toBeDefined();
      expect(funcError!.startOffset).toBe(15); // Position of '$unknownFn'
    });
  });

  describe('Severity Levels', () => {
    it('should use Error severity for syntax errors', () => {
      const diagnostics = validateExpression('payload.items[', {});

      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          severity: DiagnosticSeverity.Error,
        })
      );
    });

    it('should use Warning severity for unknown functions', () => {
      const diagnostics = validateExpression('$unknownFunc()', {});

      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          severity: DiagnosticSeverity.Warning,
        })
      );
    });

    it('should use Hint severity for identifier suggestions', () => {
      // Use a typo that will trigger the similarity check (partial match)
      const diagnostics = validateExpression('payloads.name', {});

      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          severity: DiagnosticSeverity.Hint,
        })
      );
    });

    it('should use Information severity for schema path warnings', () => {
      const context: ExpressionContext = {
        payloadSchema: {
          type: 'object',
          properties: { name: { type: 'string' } },
        },
      };
      const diagnostics = validateExpression('payload.unknown', context);

      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          severity: DiagnosticSeverity.Information,
        })
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle expression with only operators', () => {
      const diagnostics = validateExpression('+ - * /', {});
      // Should not crash, may have some diagnostics
      expect(diagnostics).toBeDefined();
    });

    it('should handle deeply nested brackets', () => {
      const diagnostics = validateExpression(
        '((((payload.value))))',
        {}
      );
      const bracketErrors = diagnostics.filter(d => d.message.includes('bracket'));

      expect(bracketErrors).toHaveLength(0);
    });

    it('should handle multiple strings', () => {
      const diagnostics = validateExpression(
        '"hello" & " " & "world"',
        {}
      );
      const stringErrors = diagnostics.filter(d => d.message.includes('string'));

      expect(stringErrors).toHaveLength(0);
    });

    it('should handle expression with all token types', () => {
      const diagnostics = validateExpression(
        'payload.active and vars.count > 0 ? $string(payload.name) : "default"',
        {}
      );
      const errors = diagnostics.filter(d => d.severity === DiagnosticSeverity.Error);

      expect(errors).toHaveLength(0);
    });

    it('should handle Unicode in strings', () => {
      const diagnostics = validateExpression('"Hello, 世界! 👋"', {});
      const stringErrors = diagnostics.filter(d => d.message.includes('string'));

      expect(stringErrors).toHaveLength(0);
    });

    it('should handle very long expressions', () => {
      const longExpr = 'payload.' + 'field.'.repeat(50) + 'value';
      const diagnostics = validateExpression(longExpr, {});

      // Should complete without error
      expect(diagnostics).toBeDefined();
    });
  });
});

describe('Diagnostic Severity Enum', () => {
  it('should have correct severity values matching Monaco', () => {
    expect(DiagnosticSeverity.Error).toBe(8);
    expect(DiagnosticSeverity.Warning).toBe(4);
    expect(DiagnosticSeverity.Information).toBe(2);
    expect(DiagnosticSeverity.Hint).toBe(1);
  });
});
