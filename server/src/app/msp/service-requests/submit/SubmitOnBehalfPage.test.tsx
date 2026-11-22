/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SubmitOnBehalfPage from './SubmitOnBehalfPage';

const listOnBehalfCatalogAction = vi.fn();
const getOnBehalfDefinitionFormAction = vi.fn();
const submitOnBehalfServiceRequestAction = vi.fn();

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@alga-psa/clients/actions', () => ({
  getContactsByClient: vi.fn(async () => [{ contact_name_id: 'contact-1', full_name: 'Casey Contact' }]),
}));

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({ ClientPicker: () => <div /> }));
vi.mock('@alga-psa/ui/components/ContactPicker', () => ({ ContactPicker: () => <div /> }));

vi.mock('../onBehalfActions', () => ({
  listOnBehalfCatalogAction: (...args: unknown[]) => listOnBehalfCatalogAction(...args),
  getOnBehalfDefinitionFormAction: (...args: unknown[]) => getOnBehalfDefinitionFormAction(...args),
  submitOnBehalfServiceRequestAction: (...args: unknown[]) => submitOnBehalfServiceRequestAction(...args),
}));

describe('SubmitOnBehalfPage renders the shared v2 request form', () => {
  beforeEach(() => {
    listOnBehalfCatalogAction.mockReset();
    getOnBehalfDefinitionFormAction.mockReset();
    submitOnBehalfServiceRequestAction.mockReset();
  });
  afterEach(() => cleanup());

  it('shows display blocks, multi-select answers and v2 validation, and submits through the MSP action', async () => {
    const user = userEvent.setup();
    listOnBehalfCatalogAction.mockResolvedValue([{ definitionId: 'def-1', title: 'New starter' }]);
    getOnBehalfDefinitionFormAction.mockResolvedValue({
      form: {
        title: 'New starter',
        description: null,
        initialValues: {},
        visibilityRules: [],
        formSchema: {
          fields: [
            { key: 'intro', type: 'callout', label: 'Heads up', helpText: 'Give us a week of notice.' },
            { key: 'name', type: 'short-text', label: 'Name', required: true, validation: { minLength: 5 } },
            {
              key: 'apps',
              type: 'multi-select',
              label: 'Apps',
              options: [
                { value: 'vpn', label: 'VPN' },
                { value: 'crm', label: 'CRM' },
              ],
            },
          ],
        },
      },
      visibilityContext: { requesterUserId: 'user-1', clientId: 'client-1', contactId: 'contact-1' },
    });
    submitOnBehalfServiceRequestAction.mockResolvedValue({ status: 'error', code: 'failed', message: 'nope' });

    render(
      <SubmitOnBehalfPage
        canSubmit
        initialClientId="client-1"
        initialContactId="contact-1"
        initialDefinitionId="def-1"
      />
    );

    // v2 element types reach the shared renderer: a display block and a multi-select input.
    await waitFor(() => expect(document.getElementById('request-service-field-name')).not.toBeNull());
    expect(screen.getByText('Give us a week of notice.')).toBeInTheDocument();
    expect(screen.getByText('Apps')).toBeInTheDocument();

    // v2 per-rule validation blocks the submit in the browser.
    await user.type(document.getElementById('request-service-field-name')!, 'Al');
    await user.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(submitOnBehalfServiceRequestAction).not.toHaveBeenCalled();
    expect(screen.getByText('detail.validation.minLength')).toBeInTheDocument();

    await user.type(document.getElementById('request-service-field-name')!, 'ice Smith');
    await user.click(screen.getByRole('button', { name: 'Submit request' }));
    await waitFor(() => expect(submitOnBehalfServiceRequestAction).toHaveBeenCalledTimes(1));
    const [clientId, contactId, definitionId, formData] = submitOnBehalfServiceRequestAction.mock.calls[0];
    expect([clientId, contactId, definitionId]).toEqual(['client-1', 'contact-1', 'def-1']);
    expect((formData as FormData).get('name')).toBe('Alice Smith');
    expect((formData as FormData).get('__algaClientSubmissionKey')).toEqual(expect.any(String));
  });
});
