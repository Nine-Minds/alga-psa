/**
 * Unit Tests for JSONata Language Definition (Monarch Tokenizer)
 *
 * Tests the tokenizer rules, language configuration, and syntax patterns
 * for the JSONata-style workflow expression language.
 */

import { describe, it, expect } from 'vitest';
import {
  LANGUAGE_ID,
  languageConfiguration,
  monarchTokensProvider,
} from '../jsonataLanguage';

describe('JSONata Language Definition', () => {
  describe('Language ID', () => {
    it('should have correct language ID', () => {
      expect(LANGUAGE_ID).toBe('jsonata-workflow');
    });
  });

  describe('Language Configuration', () => {
    it('should define bracket pairs', () => {
      expect(languageConfiguration.brackets).toContainEqual(['(', ')']);
      expect(languageConfiguration.brackets).toContainEqual(['[', ']']);
      expect(languageConfiguration.brackets).toContainEqual(['{', '}']);
    });

    it('should define auto-closing pairs', () => {
      const autoClosing = languageConfiguration.autoClosingPairs;
      expect(autoClosing).toContainEqual({ open: '(', close: ')' });
      expect(autoClosing).toContainEqual({ open: '[', close: ']' });
      expect(autoClosing).toContainEqual({ open: '{', close: '}' });
      expect(autoClosing).toContainEqual(expect.objectContaining({ open: '"', close: '"' }));
      expect(autoClosing).toContainEqual(expect.objectContaining({ open: "'", close: "'" }));
      expect(autoClosing).toContainEqual(expect.objectContaining({ open: '`', close: '`' }));
    });

    it('should define string auto-closing to not work inside strings', () => {
      const stringPairs = languageConfiguration.autoClosingPairs?.filter(
        p => p.open === '"' || p.open === "'" || p.open === '`'
      );

      for (const pair of stringPairs || []) {
        expect(pair.notIn).toContain('string');
      }
    });

    it('should define surrounding pairs', () => {
      expect(languageConfiguration.surroundingPairs).toContainEqual({ open: '(', close: ')' });
      expect(languageConfiguration.surroundingPairs).toContainEqual({ open: '"', close: '"' });
    });

    it('should define block comment syntax', () => {
      expect(languageConfiguration.comments?.blockComment).toEqual(['/*', '*/']);
    });

    it('should have word pattern for identifier matching', () => {
      expect(languageConfiguration.wordPattern).toBeInstanceOf(RegExp);
    });
  });

  describe('Monarch Tokenizer - Context Roots', () => {
    it('should define context root keywords', () => {
      const roots = monarchTokensProvider.contextRoots as string[];

      expect(roots).toContain('payload');
      expect(roots).toContain('vars');
      expect(roots).toContain('meta');
      expect(roots).toContain('error');
    });

    it('should have tokenizer rule for context roots', () => {
      const rootRules = monarchTokensProvider.tokenizer.root;
      const contextRootRule = rootRules.find(
        rule => Array.isArray(rule) && rule[0].toString().includes('payload')
      );

      expect(contextRootRule).toBeDefined();
      expect(contextRootRule?.[1]).toBe('variable.predefined');
    });
  });

  describe('Monarch Tokenizer - Keywords', () => {
    it('should define boolean and null keywords', () => {
      const keywords = monarchTokensProvider.keywords as string[];

      expect(keywords).toContain('true');
      expect(keywords).toContain('false');
      expect(keywords).toContain('null');
    });

    it('should define logical operator keywords', () => {
      const keywords = monarchTokensProvider.keywords as string[];

      expect(keywords).toContain('and');
      expect(keywords).toContain('or');
      expect(keywords).toContain('not');
      expect(keywords).toContain('in');
    });

    it('should have tokenizer rule for boolean/null constants', () => {
      const rootRules = monarchTokensProvider.tokenizer.root;
      const constRule = rootRules.find(
        rule => Array.isArray(rule) && rule[0].toString().includes('true|false|null')
      );

      expect(constRule).toBeDefined();
      expect(constRule?.[1]).toBe('keyword.constant');
    });

    it('should have tokenizer rule for logical operators', () => {
      const rootRules = monarchTokensProvider.tokenizer.root;
      const opRule = rootRules.find(
        rule => Array.isArray(rule) && rule[0].toString().includes('and|or|not|in')
      );

      expect(opRule).toBeDefined();
      expect(opRule?.[1]).toBe('keyword.operator');
    });
  });

  describe('Monarch Tokenizer - Operators', () => {
    it('should define comparison operators', () => {
      const operators = monarchTokensProvider.operators as string[];

      expect(operators).toContain('=');
      expect(operators).toContain('!=');
      expect(operators).toContain('<');
      expect(operators).toContain('>');
      expect(operators).toContain('<=');
      expect(operators).toContain('>=');
    });

    it('should define arithmetic operators', () => {
      const operators = monarchTokensProvider.operators as string[];

      expect(operators).toContain('+');
      expect(operators).toContain('-');
      expect(operators).toContain('*');
      expect(operators).toContain('/');
      expect(operators).toContain('%');
    });

    it('should define special operators', () => {
      const operators = monarchTokensProvider.operators as string[];

      expect(operators).toContain('&');  // String concatenation
      expect(operators).toContain('?');  // Conditional
      expect(operators).toContain(':');  // Conditional/object
      expect(operators).toContain('~>'); // Chain operator
      expect(operators).toContain(':='); // Variable binding
    });

    it('should have symbol pattern for operator matching', () => {
      const symbols = monarchTokensProvider.symbols as RegExp;

      expect(symbols.test('=')).toBe(true);
      expect(symbols.test('!=')).toBe(true);
      expect(symbols.test('++')).toBe(true);
      expect(symbols.test('~>')).toBe(true);
    });
  });

  describe('Monarch Tokenizer - Functions', () => {
    it('should have tokenizer rule for function calls ($name)', () => {
      const rootRules = monarchTokensProvider.tokenizer.root;
      const funcRule = rootRules.find(
        rule => Array.isArray(rule) && rule[0].toString().includes('\\$[a-zA-Z_]')
      );

      expect(funcRule).toBeDefined();
      expect(funcRule?.[1]).toBe('function');
    });

    it('function pattern should match valid function names', () => {
      const funcPattern = /\$[a-zA-Z_][a-zA-Z0-9_]*/;

      expect(funcPattern.test('$sum')).toBe(true);
      expect(funcPattern.test('$string')).toBe(true);
      expect(funcPattern.test('$my_func')).toBe(true);
      expect(funcPattern.test('$func123')).toBe(true);
    });

    it('function pattern should not match invalid patterns', () => {
      const funcPattern = /^\$[a-zA-Z_][a-zA-Z0-9_]*$/;

      expect(funcPattern.test('$123')).toBe(false);
      expect(funcPattern.test('$')).toBe(false);
      expect(funcPattern.test('sum')).toBe(false);
    });
  });

  describe('Monarch Tokenizer - Numbers', () => {
    it('should have tokenizer rule for floating point numbers', () => {
      const rootRules = monarchTokensProvider.tokenizer.root;
      const floatRule = rootRules.find(
        rule => Array.isArray(rule) && rule[1] === 'number.float'
      );

      expect(floatRule).toBeDefined();
    });

    it('should have tokenizer rule for integers', () => {
      const rootRules = monarchTokensProvider.tokenizer.root;
      const intRule = rootRules.find(
        rule => Array.isArray(rule) && rule[1] === 'number' &&
        rule[0].toString().includes('\\d+')
      );

      expect(intRule).toBeDefined();
    });

    it('should have tokenizer rule for hex numbers', () => {
      const rootRules = monarchTokensProvider.tokenizer.root;
      const hexRule = rootRules.find(
        rule => Array.isArray(rule) && rule[1] === 'number.hex'
      );

      expect(hexRule).toBeDefined();
    });

    it('number patterns should match valid numbers', () => {
      const floatPattern = /\b\d+\.\d+([eE][\-+]?\d+)?\b/;
      const intPattern = /\b\d+([eE][\-+]?\d+)?\b/;
      const hexPattern = /\b0[xX][0-9a-fA-F]+\b/;

      expect(floatPattern.test('3.14')).toBe(true);
      expect(floatPattern.test('1.0e10')).toBe(true);
      expect(floatPattern.test('2.5E-3')).toBe(true);

      expect(intPattern.test('42')).toBe(true);
      expect(intPattern.test('100')).toBe(true);
      expect(intPattern.test('1e5')).toBe(true);

      expect(hexPattern.test('0xFF')).toBe(true);
      expect(hexPattern.test('0x1A2B')).toBe(true);
    });
  });

  describe('Monarch Tokenizer - Strings', () => {
    it('should have tokenizer rules for double-quoted strings', () => {
      const rootRules = monarchTokensProvider.tokenizer.root;
      const stringRule = rootRules.find(
        rule => Array.isArray(rule) &&
        rule[0].toString() === '/^"$/' || rule[0].toString().includes('"/')
      );

      // Check for string states
      expect(monarchTokensProvider.tokenizer.string_double).toBeDefined();
    });

    it('should have tokenizer rules for single-quoted strings', () => {
      expect(monarchTokensProvider.tokenizer.string_single).toBeDefined();
    });

    it('should have tokenizer rules for backtick template strings', () => {
      expect(monarchTokensProvider.tokenizer.string_backtick).toBeDefined();
    });

    it('should detect unterminated strings as invalid', () => {
      const rootRules = monarchTokensProvider.tokenizer.root;
      const invalidStringRules = rootRules.filter(
        rule => Array.isArray(rule) && rule[1] === 'string.invalid'
      );

      expect(invalidStringRules.length).toBe(3); // double, single, backtick
    });

    it('string states should handle escape sequences', () => {
      const doubleState = monarchTokensProvider.tokenizer.string_double;
      const escapeRule = doubleState.find(
        rule => Array.isArray(rule) && rule[1] === 'string.escape'
      );

      expect(escapeRule).toBeDefined();
    });

    it('should have escape sequence pattern', () => {
      const escapes = monarchTokensProvider.escapes as RegExp;

      expect(escapes.test('\\n')).toBe(true);
      expect(escapes.test('\\t')).toBe(true);
      expect(escapes.test('\\"')).toBe(true);
      expect(escapes.test("\\'")).toBe(true);
      expect(escapes.test('\\x41')).toBe(true);
      expect(escapes.test('\\u0041')).toBe(true);
    });
  });

  describe('Monarch Tokenizer - Comments', () => {
    it('should have tokenizer rule for block comment start', () => {
      const rootRules = monarchTokensProvider.tokenizer.root;
      const commentStartRule = rootRules.find(
        rule => Array.isArray(rule) && rule[1] === 'comment' && rule[2] === '@comment'
      );

      expect(commentStartRule).toBeDefined();
    });

    it('should have comment state for block comments', () => {
      expect(monarchTokensProvider.tokenizer.comment).toBeDefined();
    });

    it('should support nested comments', () => {
      const commentState = monarchTokensProvider.tokenizer.comment;
      const nestedRule = commentState.find(
        rule => Array.isArray(rule) && rule[2] === '@push'
      );

      expect(nestedRule).toBeDefined();
    });

    it('should pop state on comment end', () => {
      const commentState = monarchTokensProvider.tokenizer.comment;
      const endRule = commentState.find(
        rule => Array.isArray(rule) && rule[2] === '@pop'
      );

      expect(endRule).toBeDefined();
    });
  });

  describe('Monarch Tokenizer - Identifiers', () => {
    it('should have tokenizer rule for identifiers', () => {
      const rootRules = monarchTokensProvider.tokenizer.root;
      const identifierRule = rootRules.find(
        rule => Array.isArray(rule) &&
        rule[0].toString().includes('[a-zA-Z_][a-zA-Z0-9_]*') &&
        typeof rule[1] === 'object' && 'cases' in (rule[1] as object)
      );

      expect(identifierRule).toBeDefined();
    });

    it('identifier cases should check context roots first', () => {
      const rootRules = monarchTokensProvider.tokenizer.root;
      const identifierRule = rootRules.find(
        rule => Array.isArray(rule) &&
        typeof rule[1] === 'object' && 'cases' in (rule[1] as object)
      );

      const cases = (identifierRule?.[1] as { cases: Record<string, string> }).cases;
      expect(cases['@contextRoots']).toBe('variable.predefined');
      expect(cases['@keywords']).toBe('keyword');
      expect(cases['@default']).toBe('identifier');
    });
  });

  describe('Monarch Tokenizer - Delimiters and Brackets', () => {
    it('should have tokenizer rule for brackets', () => {
      const rootRules = monarchTokensProvider.tokenizer.root;
      const bracketRule = rootRules.find(
        rule => Array.isArray(rule) && rule[1] === '@brackets'
      );

      expect(bracketRule).toBeDefined();
    });

    it('should have tokenizer rule for dot delimiter', () => {
      const rootRules = monarchTokensProvider.tokenizer.root;
      const dotRule = rootRules.find(
        rule => Array.isArray(rule) &&
        rule[0].toString().includes('\\.') &&
        rule[1] === 'delimiter'
      );

      expect(dotRule).toBeDefined();
    });

    it('should have tokenizer rule for comma/semicolon/colon', () => {
      const rootRules = monarchTokensProvider.tokenizer.root;
      const delimRule = rootRules.find(
        rule => Array.isArray(rule) &&
        rule[0].toString().includes('[,;:]') &&
        rule[1] === 'delimiter'
      );

      expect(delimRule).toBeDefined();
    });
  });

  describe('Monarch Tokenizer - Whitespace', () => {
    it('should have tokenizer rule for whitespace', () => {
      const rootRules = monarchTokensProvider.tokenizer.root;
      const whitespaceRule = rootRules.find(
        rule => Array.isArray(rule) && rule[1] === 'white'
      );

      expect(whitespaceRule).toBeDefined();
    });
  });

  describe('Monarch Tokenizer - Default Token', () => {
    it('should have default token set to invalid', () => {
      expect(monarchTokensProvider.defaultToken).toBe('invalid');
    });
  });
});

describe('Token Pattern Matching', () => {
  // Helper to test if a pattern matches a string
  function matchesPattern(pattern: RegExp | string, text: string): boolean {
    if (typeof pattern === 'string') return false;
    return pattern.test(text);
  }

  describe('Context Root Patterns', () => {
    const pattern = /\b(payload|vars|meta|error)\b/;

    it('should match context roots', () => {
      expect(pattern.test('payload')).toBe(true);
      expect(pattern.test('vars')).toBe(true);
      expect(pattern.test('meta')).toBe(true);
      expect(pattern.test('error')).toBe(true);
    });

    it('should not match partial context roots', () => {
      expect(pattern.test('payloads')).toBe(false);
      expect(pattern.test('variable')).toBe(false);
      expect(pattern.test('metadata')).toBe(false);
    });

    it('should match context roots with boundaries', () => {
      expect(pattern.test('payload.field')).toBe(true);
      expect(pattern.test('(payload)')).toBe(true);
    });
  });

  describe('Function Patterns', () => {
    const pattern = /\$[a-zA-Z_][a-zA-Z0-9_]*/;

    it('should match function calls', () => {
      expect(pattern.test('$sum')).toBe(true);
      expect(pattern.test('$string')).toBe(true);
      expect(pattern.test('$my_function')).toBe(true);
      expect(pattern.test('$func123')).toBe(true);
      expect(pattern.test('$_private')).toBe(true);
    });

    it('should not match invalid function names', () => {
      expect(/^\$[a-zA-Z_][a-zA-Z0-9_]*$/.test('$123')).toBe(false);
      expect(/^\$[a-zA-Z_][a-zA-Z0-9_]*$/.test('$')).toBe(false);
    });
  });

  describe('Number Patterns', () => {
    const floatPattern = /\b\d+\.\d+([eE][\-+]?\d+)?\b/;
    const intPattern = /\b\d+([eE][\-+]?\d+)?\b/;

    it('should match integers', () => {
      expect(intPattern.test('0')).toBe(true);
      expect(intPattern.test('42')).toBe(true);
      expect(intPattern.test('1000000')).toBe(true);
    });

    it('should match floats', () => {
      expect(floatPattern.test('3.14')).toBe(true);
      expect(floatPattern.test('0.5')).toBe(true);
      expect(floatPattern.test('100.00')).toBe(true);
    });

    it('should match scientific notation', () => {
      expect(floatPattern.test('1.0e10')).toBe(true);
      expect(floatPattern.test('2.5E-3')).toBe(true);
      expect(intPattern.test('1e5')).toBe(true);
    });
  });

  describe('Keyword Patterns', () => {
    const boolNullPattern = /\b(true|false|null)\b/;
    const logicalPattern = /\b(and|or|not|in)\b/;

    it('should match boolean and null literals', () => {
      expect(boolNullPattern.test('true')).toBe(true);
      expect(boolNullPattern.test('false')).toBe(true);
      expect(boolNullPattern.test('null')).toBe(true);
    });

    it('should match logical operators', () => {
      expect(logicalPattern.test('and')).toBe(true);
      expect(logicalPattern.test('or')).toBe(true);
      expect(logicalPattern.test('not')).toBe(true);
      expect(logicalPattern.test('in')).toBe(true);
    });

    it('should not match partial keywords', () => {
      expect(boolNullPattern.test('trueish')).toBe(false);
      expect(logicalPattern.test('android')).toBe(false);
      expect(logicalPattern.test('nothing')).toBe(false);
    });
  });
});
