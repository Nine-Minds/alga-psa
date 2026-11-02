import { describe, expect, it } from 'vitest';
import { AUTHORIZATION_ACTION_LABELS, getAuthorizationActions, supportsAuthorizationResourceAction } from '../bundles/resourceActions';

describe('authorization resource actions', () => {
  it('exposes project task creation as an exact project action for authoring and simulation', () => {
    expect(getAuthorizationActions('project')).toContain('create_task');
    expect(AUTHORIZATION_ACTION_LABELS.create_task).toBe('Create project task');
    expect(supportsAuthorizationResourceAction('project', 'create_task')).toBe(true);
    expect(supportsAuthorizationResourceAction('project_task', 'create_task')).toBe(false);
  });
});
