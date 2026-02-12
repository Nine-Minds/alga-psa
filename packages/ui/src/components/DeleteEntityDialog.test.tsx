/** @vitest-environment jsdom */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { DeleteEntityDialog } from './DeleteEntityDialog';

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  onConfirmDelete: vi.fn(),
  entityName: 'Sample'
};

describe('DeleteEntityDialog', () => {
  it('T044: renders spinner when isValidating=true', () => {
    const { getByText } = render(
      <DeleteEntityDialog {...baseProps} isValidating={true} validationResult={null} />
    );

    expect(getByText('Checking for dependencies...')).toBeTruthy();
  });

  it('T045: renders confirmation message with entity name when canDelete=true', () => {
    const { getByText } = render(
      <DeleteEntityDialog
        {...baseProps}
        isValidating={false}
        validationResult={{ canDelete: true, dependencies: [], alternatives: [] }}
      />
    );

    expect(getByText(/delete "Sample"/i)).toBeTruthy();
  });

  it('T046: renders Delete button when canDelete=true', () => {
    const { getByRole } = render(
      <DeleteEntityDialog
        {...baseProps}
        isValidating={false}
        validationResult={{ canDelete: true, dependencies: [], alternatives: [] }}
      />
    );

    expect(getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('T047: renders Cannot Delete title when canDelete=false', () => {
    const { getAllByText } = render(
      <DeleteEntityDialog
        {...baseProps}
        isValidating={false}
        validationResult={{
          canDelete: false,
          code: 'DEPENDENCIES_EXIST',
          message: 'Blocked',
          dependencies: [],
          alternatives: []
        }}
      />
    );

    expect(getAllByText('Cannot Delete').length).toBeGreaterThan(0);
  });

  it('T048: renders itemized dependency list with counts', () => {
    const { getByText } = render(
      <DeleteEntityDialog
        {...baseProps}
        isValidating={false}
        validationResult={{
          canDelete: false,
          code: 'DEPENDENCIES_EXIST',
          message: 'Blocked',
          dependencies: [{ type: 'ticket', count: 2, label: 'tickets' }],
          alternatives: []
        }}
      />
    );

    expect(getByText('2 tickets')).toBeTruthy();
  });

  it('T049: renders View links for dependencies with viewUrl', () => {
    const { getByText } = render(
      <DeleteEntityDialog
        {...baseProps}
        isValidating={false}
        validationResult={{
          canDelete: false,
          code: 'DEPENDENCIES_EXIST',
          message: 'Blocked',
          dependencies: [
            { type: 'ticket', count: 2, label: 'tickets', viewUrl: '/tickets' }
          ],
          alternatives: []
        }}
      />
    );

    const link = getByText('View') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/tickets');
  });

  it('T050: does not render View link when viewUrl is undefined', () => {
    const { queryByText } = render(
      <DeleteEntityDialog
        {...baseProps}
        isValidating={false}
        validationResult={{
          canDelete: false,
          code: 'DEPENDENCIES_EXIST',
          message: 'Blocked',
          dependencies: [
            { type: 'ticket', count: 2, label: 'tickets' }
          ],
          alternatives: []
        }}
      />
    );

    expect(queryByText('View')).toBeNull();
  });

  it('T051: renders primary alternative action button when alternatives exist', () => {
    const { getByRole } = render(
      <DeleteEntityDialog
        {...baseProps}
        isValidating={false}
        validationResult={{
          canDelete: false,
          code: 'DEPENDENCIES_EXIST',
          message: 'Blocked',
          dependencies: [],
          alternatives: [{ action: 'deactivate', label: 'Mark as Inactive' }]
        }}
        onAlternativeAction={vi.fn()}
      />
    );

    expect(getByRole('button', { name: 'Mark as Inactive' })).toBeTruthy();
  });

  it('T052: renders secondary alternative as outline button', () => {
    const { getByRole } = render(
      <DeleteEntityDialog
        {...baseProps}
        isValidating={false}
        validationResult={{
          canDelete: false,
          code: 'DEPENDENCIES_EXIST',
          message: 'Blocked',
          dependencies: [],
          alternatives: [
            { action: 'deactivate', label: 'Mark as Inactive' },
            { action: 'archive', label: 'Archive' }
          ]
        }}
        onAlternativeAction={vi.fn()}
      />
    );

    const button = getByRole('button', { name: 'Archive' });
    expect(button.className).toContain('border');
  });

  it('T053: does not render alternatives when none exist', () => {
    const { queryByRole } = render(
      <DeleteEntityDialog
        {...baseProps}
        isValidating={false}
        validationResult={{ canDelete: false, dependencies: [], alternatives: [] }}
      />
    );

    expect(queryByRole('button', { name: 'Mark as Inactive' })).toBeNull();
    expect(queryByRole('button', { name: 'Archive' })).toBeNull();
  });

  it('T054: shows loading spinner on buttons when isDeleting=true', () => {
    const { getByRole, getAllByRole } = render(
      <DeleteEntityDialog
        {...baseProps}
        isValidating={false}
        isDeleting={true}
        validationResult={{ canDelete: true, dependencies: [], alternatives: [] }}
      />
    );

    expect(getByRole('button', { name: /cancel/i })).toBeTruthy();
    expect(getAllByRole('status').length).toBeGreaterThan(0);
  });

  it('T055: disables all buttons when isDeleting=true', () => {
    const { getByRole } = render(
      <DeleteEntityDialog
        {...baseProps}
        isValidating={false}
        isDeleting={true}
        validationResult={{ canDelete: true, dependencies: [], alternatives: [] }}
      />
    );

    expect(getByRole('button', { name: /cancel/i })).toBeDisabled();
  });

  it('T056: calls onAlternativeAction with action type string', () => {
    const onAlternativeAction = vi.fn();
    const { getByRole } = render(
      <DeleteEntityDialog
        {...baseProps}
        isValidating={false}
        validationResult={{
          canDelete: false,
          dependencies: [],
          alternatives: [{ action: 'deactivate', label: 'Mark as Inactive' }]
        }}
        onAlternativeAction={onAlternativeAction}
      />
    );

    fireEvent.click(getByRole('button', { name: 'Mark as Inactive' }));
    expect(onAlternativeAction).toHaveBeenCalledWith('deactivate');
  });

  it('T057: calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    const { getByRole } = render(
      <DeleteEntityDialog
        {...baseProps}
        onClose={onClose}
        isValidating={false}
        validationResult={{ canDelete: true, dependencies: [], alternatives: [] }}
      />
    );

    fireEvent.click(getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('T058: calls onConfirmDelete when Delete button is clicked', () => {
    const onConfirmDelete = vi.fn();
    const { getByRole } = render(
      <DeleteEntityDialog
        {...baseProps}
        onConfirmDelete={onConfirmDelete}
        isValidating={false}
        validationResult={{ canDelete: true, dependencies: [], alternatives: [] }}
      />
    );

    fireEvent.click(getByRole('button', { name: 'Delete' }));
    expect(onConfirmDelete).toHaveBeenCalled();
  });
});
