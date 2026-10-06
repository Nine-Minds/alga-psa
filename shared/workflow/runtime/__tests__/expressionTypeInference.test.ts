import { describe, expect, it } from 'vitest';
import {
  inferExpressionResultTypes,
  type WorkflowExpressionPathSegment,
} from '../expressionTypeInference';

const PATH_TYPES: Record<string, string[]> = {
  'payload.ticketId': ['string'],
  'payload.count': ['integer'],
  'payload.nickname': ['string', 'null'],
  'payload.items[]': ['object'],
  'payload.items[].name': ['string'],
  'vars.t.ticket.priority_id': ['string', 'null'],
  'vars.t.ticket.title': ['string', 'null'],
};

const resolvePath = (segments: WorkflowExpressionPathSegment[]): Set<string> => {
  const key = segments
    .map((segment) => (segment.kind === 'index' ? '[]' : `.${segment.name}`))
    .join('')
    .replace(/^\./, '');
  return new Set(PATH_TYPES[key] ?? ['unknown']);
};

const infer = (source: string): string[] => Array.from(inferExpressionResultTypes(source, resolvePath)).sort();

describe('inferExpressionResultTypes', () => {
  it('types truncate and substring as text, with or without $', () => {
    expect(infer('truncate(vars.t.ticket.title, 40)')).toEqual(['string']);
    expect(infer('$substring(payload.ticketId, 0, 8)')).toEqual(['string']);
  });

  it('types text joined with & as string', () => {
    expect(infer('"Ticket " & payload.ticketId')).toEqual(['string']);
    expect(infer('"P1: " & vars.t.ticket.title & " needs attention"')).toEqual(['string']);
  });

  it('types comparisons and boolean logic as boolean', () => {
    expect(infer('vars.t.ticket.priority_id = "x"')).toEqual(['boolean']);
    expect(infer('vars.t.ticket.priority_id == "x"')).toEqual(['boolean']);
    expect(infer('payload.count > 3 and payload.count <= 10')).toEqual(['boolean']);
    expect(infer('payload.ticketId != "a" or payload.count < 1')).toEqual(['boolean']);
    expect(infer('payload.ticketId in ["a", "b"]')).toEqual(['boolean']);
  });

  it('types arithmetic and unary minus as number', () => {
    expect(infer('payload.count * 2 + 1')).toEqual(['number']);
    expect(infer('-payload.count')).toEqual(['number']);
  });

  it('resolves field paths through the caller and folds integer into number', () => {
    expect(infer('payload.ticketId')).toEqual(['string']);
    expect(infer('payload.count')).toEqual(['number']);
    expect(infer('vars.t.ticket.priority_id')).toEqual(['null', 'string']);
    expect(infer('payload.items[0].name')).toEqual(['string']);
    expect(infer('(payload.ticketId)')).toEqual(['string']);
  });

  it('unions the branches of a conditional', () => {
    expect(infer('payload.count > 1 ? "many" : "one"')).toEqual(['string']);
    expect(infer('payload.count > 1 ? payload.count : "none"')).toEqual(['number', 'string']);
  });

  it('types workflow helper and built-in function calls', () => {
    expect(infer('toString(payload.count) & " items"')).toEqual(['string']);
    expect(infer('len(payload.items)')).toEqual(['number']);
    expect(infer('nowIso()')).toEqual(['string']);
    expect(infer('append(payload.items, payload.ticketId)')).toEqual(['array']);
    expect(infer('$uppercase(payload.ticketId)')).toEqual(['string']);
  });

  it('drops null from coalesce arguments that have a fallback after them', () => {
    expect(infer('coalesce(payload.nickname, "unknown")')).toEqual(['string']);
  });

  it('types literals', () => {
    expect(infer('"text"')).toEqual(['string']);
    expect(infer('42')).toEqual(['number']);
    expect(infer('true')).toEqual(['boolean']);
    expect(infer('null')).toEqual(['null']);
    expect(infer('[1, 2]')).toEqual(['array']);
    expect(infer('{"a": 1}')).toEqual(['object']);
  });

  it('reports unknown for unresolvable paths, filters, and syntax errors', () => {
    expect(infer('meta.runId')).toEqual(['unknown']);
    expect(infer('payload.items[name = "x"]')).toEqual(['unknown']);
    expect(infer('payload.ticketId &')).toEqual(['unknown']);
    expect(infer('')).toEqual(['unknown']);
  });
});
