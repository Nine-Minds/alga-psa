import type { InboundActionTargetFieldType } from '@alga-psa/shared/inboundWebhooks/actions/registry';

export type FieldMappingMode = 'static' | 'expression';

export interface ParsedFieldMapping {
  mode: FieldMappingMode;
  staticValue: string;
  expression: string;
}

const STRING_LITERAL = /^"((?:[^"\\]|\\.)*)"$/;
const SINGLE_QUOTE_LITERAL = /^'((?:[^'\\]|\\.)*)'$/;
const NUMBER_LITERAL = /^-?\d+(?:\.\d+)?$/;
const BOOLEAN_LITERAL = /^(?:true|false)$/;

function unescapeJsonataString(literal: string): string {
  return literal.replace(/\\(["\\nrtbf/])/g, (_, ch) => {
    switch (ch) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case 'b':
        return '\b';
      case 'f':
        return '\f';
      default:
        return ch;
    }
  });
}

function escapeJsonataString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

export function parseFieldMappingValue(
  raw: string | undefined | null,
  type: InboundActionTargetFieldType,
): ParsedFieldMapping {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    return { mode: 'static', staticValue: '', expression: '' };
  }

  if (type === 'string' || type === 'ref' || type === 'enum') {
    const stringMatch = trimmed.match(STRING_LITERAL);
    if (stringMatch) {
      return { mode: 'static', staticValue: unescapeJsonataString(stringMatch[1]), expression: '' };
    }
    const singleMatch = trimmed.match(SINGLE_QUOTE_LITERAL);
    if (singleMatch) {
      return { mode: 'static', staticValue: singleMatch[1], expression: '' };
    }
    return { mode: 'expression', staticValue: '', expression: trimmed };
  }

  if (type === 'int' || type === 'number') {
    if (NUMBER_LITERAL.test(trimmed)) {
      return { mode: 'static', staticValue: trimmed, expression: '' };
    }
    return { mode: 'expression', staticValue: '', expression: trimmed };
  }

  if (type === 'boolean') {
    if (BOOLEAN_LITERAL.test(trimmed)) {
      return { mode: 'static', staticValue: trimmed, expression: '' };
    }
    return { mode: 'expression', staticValue: '', expression: trimmed };
  }

  // json — try parsing as JSON literal first
  try {
    JSON.parse(trimmed);
    return { mode: 'static', staticValue: trimmed, expression: '' };
  } catch {
    return { mode: 'expression', staticValue: '', expression: trimmed };
  }
}

export type FieldMappingValidationCode =
  | 'INVALID_INT'
  | 'INVALID_NUMBER'
  | 'INVALID_BOOLEAN'
  | 'INVALID_JSON';

export class FieldMappingValidationError extends Error {
  public readonly code: FieldMappingValidationCode;
  public readonly value: string;

  constructor(code: FieldMappingValidationCode, value: string) {
    super(`${code}: ${value}`);
    this.name = 'FieldMappingValidationError';
    this.code = code;
    this.value = value;
  }
}

export function serializeFieldMappingValue(
  mode: FieldMappingMode,
  value: string,
  type: InboundActionTargetFieldType,
): string {
  if (mode === 'expression') {
    return value.trim();
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (type === 'string' || type === 'ref' || type === 'enum') {
    return `"${escapeJsonataString(trimmed)}"`;
  }

  if (type === 'int') {
    if (!/^-?\d+$/.test(trimmed)) {
      throw new FieldMappingValidationError('INVALID_INT', trimmed);
    }
    return trimmed;
  }

  if (type === 'number') {
    if (!NUMBER_LITERAL.test(trimmed)) {
      throw new FieldMappingValidationError('INVALID_NUMBER', trimmed);
    }
    return trimmed;
  }

  if (type === 'boolean') {
    const lowered = trimmed.toLowerCase();
    if (lowered !== 'true' && lowered !== 'false') {
      throw new FieldMappingValidationError('INVALID_BOOLEAN', trimmed);
    }
    return lowered;
  }

  // json — validate that it parses
  try {
    JSON.parse(trimmed);
  } catch {
    throw new FieldMappingValidationError('INVALID_JSON', trimmed);
  }
  return trimmed;
}
