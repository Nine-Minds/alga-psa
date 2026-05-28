import { describe, expect, it } from 'vitest';
import { WORKFLOW_JSON_TRANSFORM_GUIDANCE } from '../../services/chatWorkflowJsonTransformGuidance';

describe('workflow JSON transform Quick Ask guidance', () => {
  it('includes action names, JSONata examples, saveAs guidance, and deterministic runtime note', () => {
    expect(WORKFLOW_JSON_TRANSFORM_GUIDANCE).toContain('transform.parse_json');
    expect(WORKFLOW_JSON_TRANSFORM_GUIDANCE).toContain('transform.query_json');
    expect(WORKFLOW_JSON_TRANSFORM_GUIDANCE).toContain('transform.stringify_json');
    expect(WORKFLOW_JSON_TRANSFORM_GUIDANCE).toContain('saveAs');
    expect(WORKFLOW_JSON_TRANSFORM_GUIDANCE).toContain('coalesce');
    expect(WORKFLOW_JSON_TRANSFORM_GUIDANCE).toContain('assets[type = "server"]');
    expect(WORKFLOW_JSON_TRANSFORM_GUIDANCE).toContain('Paste JSONata into transform.query_json.inputMapping.expression');
    expect(WORKFLOW_JSON_TRANSFORM_GUIDANCE).toContain('serverTags');
    expect(WORKFLOW_JSON_TRANSFORM_GUIDANCE).toContain('AI helps author deterministic workflow configuration');
    expect(WORKFLOW_JSON_TRANSFORM_GUIDANCE).toContain('workflow runtime executes transform.parse_json and transform.query_json');
    expect(WORKFLOW_JSON_TRANSFORM_GUIDANCE).toContain('AI does not execute inside workflow runtime');
  });

  it('documents the secret-derived saveAs exposure risk for workflow authors', () => {
    expect(WORKFLOW_JSON_TRANSFORM_GUIDANCE).toContain('source JSON originates from a secret value');
    expect(WORKFLOW_JSON_TRANSFORM_GUIDANCE).toContain('persist that content into payload/vars/meta');
  });
});
