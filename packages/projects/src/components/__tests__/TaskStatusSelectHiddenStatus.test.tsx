/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import '@testing-library/jest-dom/vitest';

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ProjectStatus } from '@alga-psa/types';
import { TaskStatusSelect } from '../TaskStatusSelect';

/** No i18next instance under test, so resolve each call to its inline default. */
function translate(key: string, arg2?: unknown): string {
  if (typeof arg2 === 'string') return arg2;
  const opts = arg2 && typeof arg2 === 'object' ? (arg2 as Record<string, unknown>) : {};
  return typeof opts.defaultValue === 'string' ? opts.defaultValue : key;
}

vi.mock('react-i18next', () => ({
  useTranslation: () => {
    const i18n = { isInitialized: true, language: 'en' };
    return Object.assign([translate, i18n, true], { t: translate, i18n, ready: true });
  },
}));

// First CYCLE_COLORS entry (gray-400) — the safe default and the index-0 cycle color.
const FIRST_CYCLE_COLOR = 'rgb(156, 163, 175)';

function makeStatus(overrides: Partial<ProjectStatus> & { project_status_mapping_id: string }): ProjectStatus {
  return {
    status_id: `status-${overrides.project_status_mapping_id}`,
    name: 'Unnamed',
    custom_name: null,
    is_visible: true,
    display_order: 1,
    is_standard: false,
    is_closed: false,
    ...overrides,
  };
}

const VISIBLE_STATUS = makeStatus({
  project_status_mapping_id: 'mapping-visible',
  name: 'Yellow Brick Road',
  display_order: 1,
});

// Admin-hidden status (is_visible false) — still valid data on an existing task.
const HIDDEN_STATUS = makeStatus({
  project_status_mapping_id: 'mapping-hidden',
  name: 'Poppy Field',
  display_order: 2,
  is_visible: false,
});

afterEach(() => {
  cleanup();
});

describe('TaskStatusSelect with a hidden selected status', () => {
  it('renders a hidden colorless status without throwing', () => {
    expect(() =>
      render(
        <TaskStatusSelect
          id="task-status-select"
          value={HIDDEN_STATUS.project_status_mapping_id}
          statuses={[VISIBLE_STATUS, HIDDEN_STATUS]}
          onValueChange={() => undefined}
        />
      )
    ).not.toThrow();

    const trigger = screen.getByRole('combobox', { name: 'Task status' });
    expect(trigger).toHaveTextContent(HIDDEN_STATUS.name);
    // The fallback color must still resolve to a usable hex (getTextColor reads it).
    expect(trigger).toHaveStyle({ backgroundColor: 'rgb(129, 140, 248)' });
  });

  it('still colors a visible colorless status by its visible index', () => {
    render(
      <TaskStatusSelect
        id="task-status-select"
        value={VISIBLE_STATUS.project_status_mapping_id}
        statuses={[VISIBLE_STATUS, HIDDEN_STATUS]}
        onValueChange={() => undefined}
      />
    );

    const trigger = screen.getByRole('combobox', { name: 'Task status' });
    expect(trigger).toHaveTextContent(VISIBLE_STATUS.name);
    expect(trigger).toHaveStyle({ backgroundColor: FIRST_CYCLE_COLOR });
  });
});
