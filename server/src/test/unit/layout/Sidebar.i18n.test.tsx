/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Sidebar from '../../../components/layout/Sidebar';

const routerPush = vi.fn();
let isMspI18nEnabled = true;
let translations: Record<string, string> = {};

vi.mock('next/navigation', () => ({
  usePathname: () => '/msp/dashboard',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push: routerPush,
  }),
}));

vi.mock('next/image', () => ({
  default: ({ alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => <img alt={alt} {...props} />,
}));

vi.mock('@alga-psa/core', () => ({
  getAppVersion: () => '1.2.3',
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => ({
    enabled: isMspI18nEnabled,
  }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | { defaultValue?: string }) => {
      if (translations[key]) {
        return translations[key];
      }

      if (typeof options === 'string') {
        return options;
      }

      return options?.defaultValue ?? key;
    },
  }),
}));

vi.mock('@radix-ui/react-tooltip', () => ({
  Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Root: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Trigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Content: ({
    children,
    side: _side,
    sideOffset: _sideOffset,
    ...props
  }: {
    children: React.ReactNode;
    side?: string;
    sideOffset?: number;
  }) => <div {...props}>{children}</div>,
  Arrow: () => null,
}));

vi.mock('@alga-psa/ui/components/CollapseToggleButton', () => ({
  CollapseToggleButton: ({
    isCollapsed,
    collapsedLabel,
    expandedLabel,
    onClick,
  }: {
    isCollapsed: boolean;
    collapsedLabel: string;
    expandedLabel: string;
    onClick: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {isCollapsed ? collapsedLabel : expandedLabel}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/extensions/DynamicNavigationSlot', () => ({
  DynamicNavigationSlot: () => <div>Dynamic navigation slot</div>,
}));

vi.mock('../../../components/layout/GitHubStarButton', () => ({
  default: () => <div>GitHub star</div>,
}));

describe('Sidebar i18n wiring', () => {
  beforeEach(() => {
    routerPush.mockReset();
    isMspI18nEnabled = true;
    translations = {
      'nav.home': 'Accueil',
      'nav.tickets': 'Tickets FR',
      'sidebar.goToDashboard': 'Aller au tableau de bord',
      'sidebar.logoAlt': 'Logo AlgaPSA FR',
      'sidebar.expandSidebar': 'Developper la barre laterale',
      'sidebar.collapseSidebar': 'Reduire la barre laterale',
      'sidebar.backToMain': 'Retour principal',
      'settings.sections.organizationAccess': 'Organisation et acces',
      'nav.billing.sections.contracts': 'Contrats FR',
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('T010: main navigation items display translated text when translations are available', () => {
    render(
      <Sidebar
        sidebarOpen={true}
        setSidebarOpen={vi.fn()}
      />
    );

    expect(screen.getByRole('link', { name: 'Accueil' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tickets FR' })).toBeInTheDocument();
  });

  it('T011: English fallback labels remain when translated values are unavailable', () => {
    translations = {};

    render(
      <Sidebar
        sidebarOpen={true}
        setSidebarOpen={vi.fn()}
      />
    );

    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tickets' })).toBeInTheDocument();
  });

  it('T012/T013/T014/T015: collapsed sidebar tooltips and chrome labels use translations', () => {
    render(
      <Sidebar
        sidebarOpen={false}
        setSidebarOpen={vi.fn()}
      />
    );

    expect(screen.getByText('Accueil')).toBeInTheDocument();
    expect(screen.getByLabelText('Aller au tableau de bord')).toBeInTheDocument();
    expect(screen.getByAltText('Logo AlgaPSA FR')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Developper la barre laterale' })).toBeInTheDocument();
  });

  it('T016/T018: settings mode section title and Back to Main controls are translated', () => {
    render(
      <Sidebar
        sidebarOpen={true}
        setSidebarOpen={vi.fn()}
        mode="settings"
      />
    );

    expect(screen.getByText('Organisation et acces')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retour principal/ })).toBeInTheDocument();
  });

  it('T017/T018: billing mode section title and collapsed Back to Main tooltip are translated', () => {
    render(
      <Sidebar
        sidebarOpen={true}
        setSidebarOpen={vi.fn()}
        mode="billing"
      />
    );

    expect(screen.getByText('Contrats FR')).toBeInTheDocument();
    expect(screen.getByText('Retour principal')).toBeInTheDocument();
  });

  it('T066: Language settings item is hidden when the MSP i18n flag is off', () => {
    isMspI18nEnabled = false;
    translations = {};

    render(
      <Sidebar
        sidebarOpen={true}
        setSidebarOpen={vi.fn()}
        mode="settings"
      />
    );

    expect(screen.getByRole('link', { name: 'General' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Language' })).not.toBeInTheDocument();
  });
});
