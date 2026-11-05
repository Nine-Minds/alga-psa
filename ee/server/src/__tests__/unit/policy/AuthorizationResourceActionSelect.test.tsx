/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AuthorizationResourceActionSelect from '../../../components/settings/policy/AuthorizationResourceActionSelect';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe('AuthorizationResourceActionSelect', () => {
  it('allows a project task action to be selected and returns its exact persisted value', async () => {
    const onValueChange = vi.fn();
    render(
      <AuthorizationResourceActionSelect
        id="project-action"
        resourceType="project"
        value="read"
        onValueChange={onValueChange}
      />
    );

    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'Create project task' }));

    expect(onValueChange).toHaveBeenCalledWith('create_task');
  });
});
