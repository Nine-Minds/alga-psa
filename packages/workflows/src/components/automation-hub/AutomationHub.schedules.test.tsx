/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentSearchParams = new URLSearchParams('tab=schedules');
const router = {
  push: vi.fn(),
  replace: vi.fn()
};

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => currentSearchParams
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

vi.mock('@alga-psa/ui/components/CustomTabs', () => ({
  __esModule: true,
  default: ({
    tabs,
    defaultTab
  }: {
    tabs: Array<{ label: string; content: React.ReactNode }>;
    defaultTab?: string;
  }) => (
    <div>
      <div>
        {tabs.map((tab) => (
          <button key={tab.label} type="button">{tab.label}</button>
        ))}
      </div>
      <div>{tabs.find((tab) => tab.label === defaultTab)?.content ?? null}</div>
    </div>
  )
}));

vi.mock('./TemplateLibrary', () => ({
  __esModule: true,
  default: () => <div>Template library panel</div>
}));

vi.mock('./Workflows', () => ({
  __esModule: true,
  default: () => <div>Workflows panel</div>
}));

vi.mock('./Schedules', () => ({
  __esModule: true,
  default: () => <div>Schedules panel</div>
}));

vi.mock('./EventsCatalogV2', () => ({
  __esModule: true,
  default: () => <div>Events catalog panel</div>
}));

vi.mock('./LogsHistory', () => ({
  __esModule: true,
  default: () => <div>Logs history panel</div>
}));

import AutomationHub from './AutomationHub';

describe('AutomationHub schedules tab', () => {
  beforeEach(() => {
    currentSearchParams = new URLSearchParams('tab=schedules');
    router.push.mockReset();
    router.replace.mockReset();
  });

  it('shows the schedules tab and renders schedules route state', () => {
    render(<AutomationHub />);

    expect(screen.getByText('Schedules')).toBeInTheDocument();
    expect(screen.getByText('Schedules panel')).toBeInTheDocument();
  });
});
