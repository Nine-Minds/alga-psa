/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import TreeSelect, { TreeSelectOption, TreeSelectPath } from '../TreeSelect';

beforeAll(async () => {
  if (!i18next.isInitialized) {
    await i18next.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: 'en',
      resources: { en: { common: {} } },
      interpolation: { escapeValue: false },
    });
  }
});

type NodeType = 'project' | 'phase' | 'status';

// Project task status mappings are shared across phases, so the same status value
// shows up under every phase of a project.
const SHARED_STATUS = 'status-in-progress';

const options: TreeSelectOption<NodeType>[] = [
  {
    label: 'Website Rebuild',
    value: 'project-1',
    type: 'project',
    children: [
      {
        label: 'Discovery',
        value: 'phase-1',
        type: 'phase',
        children: [{ label: 'In Progress', value: SHARED_STATUS, type: 'status' }],
      },
      {
        label: 'Delivery',
        value: 'phase-2',
        type: 'phase',
        children: [{ label: 'In Progress', value: SHARED_STATUS, type: 'status' }],
      },
    ],
  },
];

describe('TreeSelect display label', () => {
  it('resolves the label through selectedPath when a value repeats across branches', () => {
    const selectedPath: TreeSelectPath = {
      project: 'project-1',
      phase: 'phase-2',
      status: SHARED_STATUS,
    };

    render(
      <TreeSelect<NodeType>
        options={options}
        value={SHARED_STATUS}
        selectedPath={selectedPath}
        onValueChange={() => {}}
        placeholder="Select target"
      />
    );

    expect(screen.getByText('Website Rebuild > Delivery > In Progress')).toBeTruthy();
  });

  it('falls back to the first depth-first match without selectedPath', () => {
    render(
      <TreeSelect<NodeType>
        options={options}
        value={SHARED_STATUS}
        onValueChange={() => {}}
        placeholder="Select target"
      />
    );

    expect(screen.getByText('Website Rebuild > Discovery > In Progress')).toBeTruthy();
  });
});
