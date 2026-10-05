/**
 * @vitest-environment jsdom
 *
 * alga0002338: a full edit save from the quick-view bento layout is a
 * "changes saved" event, so it must fire onChangesSaved (the client Contacts
 * tab relies on it to drop a contact that moved to another client).
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ContactBentoLayout from './ContactBentoLayout';

const hoisted = vi.hoisted(() => ({
  openDrawer: vi.fn(),
  closeDrawer: vi.fn(),
}));

// Stable references: the layout lists these in effect dependencies.
vi.mock('@alga-psa/ui', () => {
  const toast = vi.fn();
  const drawer = { openDrawer: hoisted.openDrawer, closeDrawer: hoisted.closeDrawer };
  const toastApi = { toast };
  return { useDrawer: () => drawer, useToast: () => toastApi };
});
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;
  const value = { t };
  return { useTranslation: () => value };
});
vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => {
  const value = { renderDocuments: () => null, getDocumentsByEntity: vi.fn() };
  return { useDocumentsCrossFeature: () => value };
});
vi.mock('@alga-psa/clients/actions', () => ({
  updateContact: vi.fn(),
  getInteractionsForEntity: vi.fn().mockResolvedValue([]),
}));
vi.mock('@alga-psa/tags/components', () => ({ TagManager: () => null }));
vi.mock('@alga-psa/ui/keyboard-shortcuts', () => ({ usePageCreateShortcut: () => undefined }));
vi.mock('@alga-psa/ui/components/Dialog', () => ({ Dialog: () => null, DialogContent: () => null }));
vi.mock('../../../context/ClientCrossFeatureContext', () => ({ useOptionalClientCrossFeature: () => null }));
vi.mock('../../interactions/QuickAddInteraction', () => ({ QuickAddInteraction: () => null }));
vi.mock('../../interactions/InteractionDetails', () => ({ default: () => null }));
vi.mock('../ContactPortalTab', () => ({ ContactPortalTab: () => null }));
vi.mock('../ContactCredentialsSection', () => ({ ContactCredentialsSection: () => null }));
vi.mock('../ContactDetailsEdit', () => ({ default: () => null }));

const contact: any = {
  contact_name_id: 'contact-1',
  tenant: 'tenant-1',
  full_name: 'Brian Linscott',
  email: 'brian@example.com',
  client_id: 'triage-id',
  phone_numbers: [],
  additional_email_addresses: [],
  is_inactive: false,
};

describe('ContactBentoLayout full edit save', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fires onChangesSaved and onContactUpdated when the edit drawer saves', () => {
    const onChangesSaved = vi.fn();
    const onContactUpdated = vi.fn();
    render(
      <ContactBentoLayout
        contact={contact}
        clients={[]}
        quickView
        onChangesSaved={onChangesSaved}
        onContactUpdated={onContactUpdated}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: /edit contact/i })[0]);
    expect(hoisted.openDrawer).toHaveBeenCalledTimes(1);
    const drawerElement = hoisted.openDrawer.mock.calls[0][0] as React.ReactElement<any>;
    expect(onChangesSaved).not.toHaveBeenCalled();

    drawerElement.props.onSave({ ...contact, client_id: 'life-id' });

    expect(hoisted.closeDrawer).toHaveBeenCalledTimes(1);
    expect(onChangesSaved).toHaveBeenCalledTimes(1);
    expect(onContactUpdated).toHaveBeenCalledTimes(1);
  });
});
