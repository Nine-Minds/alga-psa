/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Header from '../../../components/layout/Header';

const routerPush = vi.fn();
const signOut = vi.fn();
let pathname = '/msp/tickets';
let translations: Record<string, string> = {};

const interpolate = (template: string, values: Record<string, unknown> = {}) =>
  template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key) => String(values[key] ?? ''));

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({
    push: routerPush,
  }),
}));

vi.mock('next-auth/react', () => ({
  signOut: (...args: unknown[]) => signOut(...args),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown> | string) => {
      const defaultValue = typeof options === 'string' ? options : String(options?.defaultValue ?? key);
      const template = translations[key] ?? defaultValue;
      return typeof options === 'object' && options
        ? interpolate(template, options)
        : template;
    },
  }),
}));

vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
    ...props
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
  }) => (
    <button type="button" onClick={onSelect} {...props}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({
    children,
    onClick,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/ThemeToggle', () => ({
  ThemeToggle: () => <div>Theme toggle</div>,
}));

vi.mock('@alga-psa/ui/components/UserAvatar', () => ({
  default: () => <div>User avatar</div>,
}));

vi.mock('@alga-psa/ui/components/ContactAvatar', () => ({
  default: () => <div>Contact avatar</div>,
}));

vi.mock('@alga-psa/notifications/components', () => ({
  NotificationBell: () => <div>Notifications</div>,
}));

vi.mock('../../../components/layout/QuickCreateDialog', () => ({
  QuickCreateDialog: () => <div>Quick create dialog</div>,
}));

vi.mock('../../../components/layout/TrialBanner', () => ({
  TrialBanner: () => <div>Trial banner</div>,
}));

vi.mock('../../../components/layout/PaymentFailedBanner', () => ({
  PaymentFailedBanner: () => <div>Payment failed banner</div>,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({
    user_id: 'user-1',
    user_type: 'internal',
    first_name: 'Ada',
    last_name: 'Lovelace',
    tenant: 'Acme MSP',
  }),
}));

vi.mock('@alga-psa/user-composition/hooks', () => ({
  useUserAvatar: () => ({ avatarUrl: null }),
  useContactAvatar: () => ({ avatarUrl: null }),
}));

vi.mock('@alga-psa/auth/actions', () => ({
  checkAccountManagementPermission: vi.fn().mockResolvedValue(true),
}));

vi.mock('@alga-psa/jobs/actions', () => ({
  getQueueMetricsAction: vi.fn().mockResolvedValue({
    active: 3,
    queued: 5,
    failed: 1,
  }),
}));

vi.mock('@alga-psa/analytics/client', () => ({
  analytics: {
    capture: vi.fn(),
  },
}));

describe('Header i18n wiring', () => {
  beforeEach(() => {
    pathname = '/msp/tickets';
    routerPush.mockReset();
    signOut.mockReset();
    translations = {
      'header.quickCreate.ariaLabel': 'Ouvrir creation rapide',
      'header.quickCreate.title': 'Creation rapide',
      'header.quickCreate.heading': 'Creer',
      'header.quickCreate.options.ticket.label': 'Ticket FR',
      'header.quickCreate.options.ticket.description': 'Creer un ticket d assistance',
      'header.quickCreate.options.client.label': 'Client FR',
      'header.quickCreate.options.client.description': 'Ajouter un client',
      'header.quickCreate.options.contact.label': 'Contact FR',
      'header.quickCreate.options.contact.description': 'Ajouter un contact',
      'header.quickCreate.options.project.label': 'Projet FR',
      'header.quickCreate.options.project.description': 'Demarrer un projet',
      'header.quickCreate.options.asset.label': 'Actif FR',
      'header.quickCreate.options.asset.description': 'Ajouter un appareil',
      'header.quickCreate.options.service.label': 'Service FR',
      'header.quickCreate.options.service.description': 'Ajouter un service facturable',
      'header.quickCreate.options.product.label': 'Produit FR',
      'header.quickCreate.options.product.description': 'Ajouter un produit au catalogue',
      'header.jobs.ariaLabel': 'Voir les taches en arriere-plan',
      'header.jobs.title': 'Taches en arriere-plan',
      'header.jobs.description': 'Suivre les importations et l automatisation.',
      'header.jobs.active': 'Taches actives',
      'header.jobs.queued': 'Taches en file',
      'header.jobs.failedLast24h': 'Echecs sur 24 h',
      'header.jobs.openJobCenter': 'Ouvrir le centre des taches',
      'header.breadcrumb.home': 'Accueil fil',
      'header.breadcrumb.dashboard': 'Tableau de bord FR',
      'nav.tickets': 'Tickets traduits',
      'header.tenantBadge.ariaLabel': 'Locataire actif {{tenant}}',
      'header.userFallback': 'Utilisateur',
      'header.quickAccess': 'Acces rapide au profil et au compte.',
      'header.profile': 'Profil FR',
      'header.account': 'Compte FR',
      'header.signOut': 'Deconnexion FR',
    };
  });

  it('T019-T023: quick create trigger, heading, and all option labels/descriptions are translated', async () => {
    render(
      <Header
        sidebarOpen={true}
        setSidebarOpen={vi.fn()}
        rightSidebarOpen={false}
        setRightSidebarOpen={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Ouvrir creation rapide' })).toBeInTheDocument();
    expect(screen.getByText('Creation rapide')).toBeInTheDocument();
    expect(screen.getByText('Creer')).toBeInTheDocument();
    expect(screen.getByText('Ticket FR')).toBeInTheDocument();
    expect(screen.getByText('Creer un ticket d assistance')).toBeInTheDocument();
    expect(screen.getByText('Client FR')).toBeInTheDocument();
    expect(screen.getByText('Ajouter un client')).toBeInTheDocument();
    expect(screen.getByText('Contact FR')).toBeInTheDocument();
    expect(screen.getByText('Ajouter un contact')).toBeInTheDocument();
    expect(screen.getByText('Projet FR')).toBeInTheDocument();
    expect(screen.getByText('Demarrer un projet')).toBeInTheDocument();
    expect(screen.getByText('Actif FR')).toBeInTheDocument();
    expect(screen.getByText('Ajouter un appareil')).toBeInTheDocument();
    expect(screen.getByText('Service FR')).toBeInTheDocument();
    expect(screen.getByText('Ajouter un service facturable')).toBeInTheDocument();
    expect(screen.getByText('Produit FR')).toBeInTheDocument();
    expect(screen.getByText('Ajouter un produit au catalogue')).toBeInTheDocument();
  });

  it('T024-T026: job activity indicator strings are translated', async () => {
    render(
      <Header
        sidebarOpen={true}
        setSidebarOpen={vi.fn()}
        rightSidebarOpen={false}
        setRightSidebarOpen={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Voir les taches en arriere-plan' })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Taches en arriere-plan')).toBeInTheDocument();
    });

    expect(screen.getByText('Suivre les importations et l automatisation.')).toBeInTheDocument();
    expect(screen.getByText('Taches actives')).toBeInTheDocument();
    expect(screen.getByText('Taches en file')).toBeInTheDocument();
    expect(screen.getByText('Echecs sur 24 h')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ouvrir le centre des taches' })).toBeInTheDocument();
  });

  it('T027-T029: breadcrumb home label, translated nav name, and tenant badge aria-label are localized', async () => {
    render(
      <Header
        sidebarOpen={true}
        setSidebarOpen={vi.fn()}
        rightSidebarOpen={false}
        setRightSidebarOpen={vi.fn()}
      />
    );

    expect(screen.getByRole('link', { name: 'Accueil fil' })).toBeInTheDocument();
    expect(screen.getByText('Tickets traduits')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByLabelText('Locataire actif Acme MSP')).toBeInTheDocument();
    });
  });
});
