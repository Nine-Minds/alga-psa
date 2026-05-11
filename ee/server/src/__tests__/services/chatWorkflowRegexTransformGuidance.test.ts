import { describe, expect, it } from 'vitest';
import { WORKFLOW_REGEX_TRANSFORM_GUIDANCE } from '../../services/chatWorkflowRegexTransformGuidance';

describe('workflow regex transform Quick Ask guidance', () => {
  it('includes action names, JS regex syntax, capture/replacement examples, guardrails, saveAs, and deterministic runtime note', () => {
    expect(WORKFLOW_REGEX_TRANSFORM_GUIDANCE).toContain('transform.regex_match');
    expect(WORKFLOW_REGEX_TRANSFORM_GUIDANCE).toContain('transform.regex_extract');
    expect(WORKFLOW_REGEX_TRANSFORM_GUIDANCE).toContain('transform.regex_replace');
    expect(WORKFLOW_REGEX_TRANSFORM_GUIDANCE).toContain('JavaScript RegExp pattern bodies without surrounding slashes');
    expect(WORKFLOW_REGEX_TRANSFORM_GUIDANCE).toContain('d, g, i, m, s, u, v, y');
    expect(WORKFLOW_REGEX_TRANSFORM_GUIDANCE).toContain('maxMatches');
    expect(WORKFLOW_REGEX_TRANSFORM_GUIDANCE).toContain('$<name>');
    expect(WORKFLOW_REGEX_TRANSFORM_GUIDANCE).toContain('saveAs');
    expect(WORKFLOW_REGEX_TRANSFORM_GUIDANCE).toContain('INC-(?<incidentId>');
    expect(WORKFLOW_REGEX_TRANSFORM_GUIDANCE).toContain('host\\\\s+(?<host>');
    expect(WORKFLOW_REGEX_TRANSFORM_GUIDANCE).toContain('AI only helps author deterministic workflow configuration');
  });

  it('warns about persisting sensitive captures into workflow state', () => {
    expect(WORKFLOW_REGEX_TRANSFORM_GUIDANCE).toContain('sensitive or secret-derived text');
    expect(WORKFLOW_REGEX_TRANSFORM_GUIDANCE).toContain('persist it to payload/vars/meta');
  });
});
