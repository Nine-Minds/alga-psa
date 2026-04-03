/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QuickCreateDialog, type QuickCreateType } from '../../../components/layout/QuickCreateDialog';

const routerRefresh = vi.fn();
const toastSuccess = vi.fn();
const handleError = vi.fn();
const getAllClients = vi.fn();
const getServiceTypesForSelection = vi.fn();

const translations: Record<string, string> = {
  'quickCreate.success.asset': 'Actif cree avec succes',
  'quickCreate.success.ticket': 'Ticket no {{number}} cree avec succes',
  'quickCreate.success.client': 'Client "{{name}}" cree avec succes',
  'quickCreate.success.contact': '{{name}} ajoute avec succes',
  'quickCreate.success.project': 'Projet "{{name}}" cree avec succes',
  'quickCreate.success.service': 'Service cree avec succes',
  'quickCreate.success.product': 'Produit cree avec succes',
  'quickCreate.errors.loadClients': 'Impossible de charger les clients',
  'quickCreate.errors.loadServiceTypes': 'Impossible de charger les types de service',
  'quickCreate.dialogTitles.contact': 'Ajouter un contact',
  'quickCreate.dialogTitles.project': 'Ajouter un projet',
  'quickCreate.dialogTitles.service': 'Ajouter un service',
};

const interpolate = (template: string, values: Record<string, unknown> = {}) =>
  template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key) => String(values[key] ?? ''));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: routerRefresh,
  }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      interpolate(translations[key] ?? String(options?.defaultValue ?? key), options),
  }),
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError: (...args: unknown[]) => handleError(...args),
}));

vi.mock('@alga-psa/clients/actions', () => ({
  getAllClients: (...args: unknown[]) => getAllClients(...args),
}));

vi.mock('@alga-psa/billing/actions', () => ({
  getServiceTypesForSelection: (...args: unknown[]) => getServiceTypesForSelection(...args),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({
    title,
    children,
  }: {
    title: string;
    children: React.ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/LoadingIndicator', () => ({
  default: () => <div>Loading</div>,
}));

vi.mock('@alga-psa/assets/components/QuickAddAsset', () => ({
  QuickAddAsset: ({ onAssetAdded }: { onAssetAdded: () => void }) => (
    <button type="button" onClick={onAssetAdded}>Add asset</button>
  ),
}));

vi.mock('@alga-psa/tickets/components', () => ({
  QuickAddTicket: ({ onTicketAdded }: { onTicketAdded: (ticket: { ticket_number: number }) => void }) => (
    <button type="button" onClick={() => onTicketAdded({ ticket_number: 42 })}>Add ticket</button>
  ),
}));

vi.mock('@alga-psa/clients/components/clients/QuickAddClient', () => ({
  default: ({ onClientAdded }: { onClientAdded: (client: { client_name: string }) => void }) => (
    <button type="button" onClick={() => onClientAdded({ client_name: 'Acme' })}>Add client</button>
  ),
}));

vi.mock('@alga-psa/clients/components/contacts/QuickAddContact', () => ({
  default: ({ onContactAdded }: { onContactAdded: (contact: { first_name: string; last_name: string }) => void }) => (
    <button type="button" onClick={() => onContactAdded({ first_name: 'Ada', last_name: 'Lovelace' })}>Add contact</button>
  ),
}));

vi.mock('@alga-psa/projects/components/ProjectQuickAdd', () => ({
  default: ({ onProjectAdded }: { onProjectAdded: (project: { project_name: string }) => void }) => (
    <button type="button" onClick={() => onProjectAdded({ project_name: 'Apollo' })}>Add project</button>
  ),
}));

vi.mock('@alga-psa/billing/components', () => ({
  QuickAddService: ({ onServiceAdded }: { onServiceAdded: () => void }) => (
    <button type="button" onClick={onServiceAdded}>Add service</button>
  ),
  QuickAddProduct: ({ onProductAdded }: { onProductAdded: () => void }) => (
    <button type="button" onClick={onProductAdded}>Add product</button>
  ),
}));

const renderDialog = (type: QuickCreateType) =>
  render(<QuickCreateDialog type={type} onClose={vi.fn()} />);

describe('QuickCreateDialog i18n wiring', () => {
  beforeEach(() => {
    routerRefresh.mockReset();
    toastSuccess.mockReset();
    handleError.mockReset();
    getAllClients.mockReset();
    getServiceTypesForSelection.mockReset();
    getAllClients.mockResolvedValue([]);
    getServiceTypesForSelection.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('T040-T045: success toasts are translated for every quick-create flow', async () => {
    const cases: Array<{
      type: QuickCreateType;
      buttonText: string;
      expectedToast: string;
    }> = [
      { type: 'asset', buttonText: 'Add asset', expectedToast: 'Actif cree avec succes' },
      { type: 'ticket', buttonText: 'Add ticket', expectedToast: 'Ticket no 42 cree avec succes' },
      { type: 'client', buttonText: 'Add client', expectedToast: 'Client "Acme" cree avec succes' },
      { type: 'contact', buttonText: 'Add contact', expectedToast: 'Ada Lovelace ajoute avec succes' },
      { type: 'project', buttonText: 'Add project', expectedToast: 'Projet "Apollo" cree avec succes' },
      { type: 'service', buttonText: 'Add service', expectedToast: 'Service cree avec succes' },
      { type: 'product', buttonText: 'Add product', expectedToast: 'Produit cree avec succes' },
    ];

    for (const testCase of cases) {
      renderDialog(testCase.type);
      fireEvent.click(await screen.findByRole('button', { name: testCase.buttonText }));
      expect(toastSuccess).toHaveBeenLastCalledWith(testCase.expectedToast);
      cleanup();
    }

    expect(routerRefresh).toHaveBeenCalledTimes(cases.length);
  });

  it('T046: loading dialog titles are translated for contact, project, and service', async () => {
    const pending = new Promise<never>(() => {});
    getAllClients.mockReturnValue(pending);
    getServiceTypesForSelection.mockReturnValue(pending);

    renderDialog('contact');
    expect(await screen.findByText('Ajouter un contact')).toBeInTheDocument();
    cleanup();

    renderDialog('project');
    expect(await screen.findByText('Ajouter un projet')).toBeInTheDocument();
    cleanup();

    renderDialog('service');
    expect(await screen.findByText('Ajouter un service')).toBeInTheDocument();
  });

  it('T047: translated load errors are forwarded for clients and service types', async () => {
    getAllClients.mockRejectedValueOnce(new Error('no clients'));
    renderDialog('contact');

    await waitFor(() => {
      expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'Impossible de charger les clients');
    });

    cleanup();
    getServiceTypesForSelection.mockRejectedValueOnce(new Error('no service types'));
    renderDialog('service');

    await waitFor(() => {
      expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'Impossible de charger les types de service');
    });
  });
});
