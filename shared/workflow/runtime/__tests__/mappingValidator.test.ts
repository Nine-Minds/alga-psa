import { describe, it, expect } from 'vitest';
import {
  validateInputMapping,
  collectSecretRefs,
  collectSecretRefsFromConfig
} from '../validation/mappingValidator';
import type { InputMapping } from '../types';

describe('mappingValidator', () => {
  describe('validateInputMapping', () => {
    const baseOptions = {
      stepPath: 'root.steps[0]',
      stepId: 'step-1',
      fieldName: 'inputMapping'
    };

    it('returns empty errors for undefined mapping', () => {
      const result = validateInputMapping(undefined, baseOptions);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
      expect(result.secretRefs.size).toBe(0);
    });

    it('returns empty errors for empty mapping', () => {
      const result = validateInputMapping({}, baseOptions);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('validates expression syntax', () => {
      const mapping: InputMapping = {
        field1: { $expr: 'payload.name' }
      };
      const result = validateInputMapping(mapping, baseOptions);
      expect(result.errors).toHaveLength(0);
    });

    it('reports error for empty expression', () => {
      const mapping: InputMapping = {
        field1: { $expr: '' }
      };
      const result = validateInputMapping(mapping, baseOptions);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe('EMPTY_EXPRESSION');
    });

    it('reports error for invalid expression syntax', () => {
      const mapping: InputMapping = {
        field1: { $expr: 'payload..invalid' }
      };
      const result = validateInputMapping(mapping, baseOptions);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe('INVALID_EXPRESSION');
    });

    it('validates secret references', () => {
      const mapping: InputMapping = {
        field1: { $secret: 'API_KEY' }
      };
      const result = validateInputMapping(mapping, baseOptions);
      expect(result.errors).toHaveLength(0);
      expect(result.secretRefs.has('API_KEY')).toBe(true);
    });

    it('reports error for invalid secret name format', () => {
      const mapping: InputMapping = {
        field1: { $secret: 'invalid secret name!' }
      };
      const result = validateInputMapping(mapping, baseOptions);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe('INVALID_SECRET_NAME');
    });

    it('warns about unknown secrets when knownSecrets provided', () => {
      const mapping: InputMapping = {
        field1: { $secret: 'UNKNOWN_SECRET' }
      };
      const result = validateInputMapping(mapping, {
        ...baseOptions,
        knownSecrets: new Set(['KNOWN_SECRET'])
      });
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].code).toBe('UNKNOWN_SECRET');
    });

    it('does not warn about known secrets', () => {
      const mapping: InputMapping = {
        field1: { $secret: 'KNOWN_SECRET' }
      };
      const result = validateInputMapping(mapping, {
        ...baseOptions,
        knownSecrets: new Set(['KNOWN_SECRET'])
      });
      expect(result.warnings).toHaveLength(0);
    });

    it('validates literal values', () => {
      const mapping: InputMapping = {
        stringField: 'hello',
        numberField: 42,
        boolField: true,
        nullField: null
      };
      const result = validateInputMapping(mapping, baseOptions);
      expect(result.errors).toHaveLength(0);
    });

    it('validates nested arrays', () => {
      const mapping: InputMapping = {
        arrayField: [
          { $expr: 'payload.item1' },
          { $secret: 'SECRET1' },
          'literal'
        ]
      };
      const result = validateInputMapping(mapping, baseOptions);
      expect(result.errors).toHaveLength(0);
      expect(result.secretRefs.has('SECRET1')).toBe(true);
    });

    it('validates nested objects', () => {
      const mapping: InputMapping = {
        nestedField: {
          inner: { $expr: 'payload.value' },
          secret: { $secret: 'NESTED_SECRET' }
        }
      };
      const result = validateInputMapping(mapping, baseOptions);
      expect(result.errors).toHaveLength(0);
      expect(result.secretRefs.has('NESTED_SECRET')).toBe(true);
    });

    it('warns about unknown special keys', () => {
      const mapping: InputMapping = {
        field1: { $unknown: 'value' } as unknown as { $expr: string }
      };
      const result = validateInputMapping(mapping, baseOptions);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].code).toBe('UNKNOWN_SPECIAL_KEY');
    });

    it('reports missing required fields', () => {
      const mapping: InputMapping = {
        optionalField: 'value'
      };
      const result = validateInputMapping(mapping, {
        ...baseOptions,
        requiredFields: ['requiredField1', 'requiredField2']
      });
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].code).toBe('MISSING_REQUIRED_MAPPING');
      expect(result.errors[1].code).toBe('MISSING_REQUIRED_MAPPING');
    });

    it('does not report present required fields', () => {
      const mapping: InputMapping = {
        requiredField1: 'value1',
        requiredField2: { $expr: 'payload.value' }
      };
      const result = validateInputMapping(mapping, {
        ...baseOptions,
        requiredFields: ['requiredField1', 'requiredField2']
      });
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('collectSecretRefs', () => {
    it('returns empty set for undefined mapping', () => {
      const refs = collectSecretRefs(undefined);
      expect(refs.size).toBe(0);
    });

    it('collects secret refs from simple mapping', () => {
      const mapping: InputMapping = {
        field1: { $secret: 'SECRET1' },
        field2: { $secret: 'SECRET2' },
        field3: { $expr: 'payload.value' }
      };
      const refs = collectSecretRefs(mapping);
      expect(refs.size).toBe(2);
      expect(refs.has('SECRET1')).toBe(true);
      expect(refs.has('SECRET2')).toBe(true);
    });

    it('collects secret refs from nested structures', () => {
      const mapping: InputMapping = {
        nested: {
          deep: { $secret: 'DEEP_SECRET' }
        },
        array: [
          { $secret: 'ARRAY_SECRET' }
        ]
      };
      const refs = collectSecretRefs(mapping);
      expect(refs.size).toBe(2);
      expect(refs.has('DEEP_SECRET')).toBe(true);
      expect(refs.has('ARRAY_SECRET')).toBe(true);
    });
  });

  describe('collectSecretRefsFromConfig', () => {
    it('returns empty set for undefined config', () => {
      const refs = collectSecretRefsFromConfig(undefined);
      expect(refs.size).toBe(0);
    });

    it('collects secret refs from config object', () => {
      const config = {
        inputMapping: {
          field1: { $secret: 'SECRET1' }
        },
        other: {
          nested: { $secret: 'SECRET2' }
        }
      };
      const refs = collectSecretRefsFromConfig(config);
      expect(refs.size).toBe(2);
      expect(refs.has('SECRET1')).toBe(true);
      expect(refs.has('SECRET2')).toBe(true);
    });

    it('handles arrays in config', () => {
      const config = {
        items: [
          { $secret: 'SECRET1' },
          { value: { $secret: 'SECRET2' } }
        ]
      };
      const refs = collectSecretRefsFromConfig(config);
      expect(refs.size).toBe(2);
    });
  });
});
