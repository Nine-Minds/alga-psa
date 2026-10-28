/**
 * @vitest-environment jsdom
 *
 * The shared locations editor: disabled until a client is chosen, offers the client's active
 * locations plus any inactive one the contact is still linked to, and keeps exactly one primary.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContactLocationInput } from '@alga-psa/types';

const hoisted = vi.hoisted(() => ({ getClientLocations: vi.fn() }));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: { defaultValue?: string; [k: string]: unknown }) => {
    let text = options?.defaultValue ?? key;
    for (const [name, value] of Object.entries(options ?? {})) {
      text = text.replace(`{{${name}}}`, String(value));
    }
    return text;
  };
  return { useTranslation: () => ({ t }) };
});
vi.mock('../../actions/clientLocationActions', () => ({ getClientLocations: hoisted.getClientLocations }));

import ContactLocationsEditor, {
  contactLocationSelectionError,
  normalizeContactLocationSelection,
} from './ContactLocationsEditor';

const warehouse = {
  location_id: 'warehouse', client_id: 'acme', location_name: 'Warehouse', is_active: true, is_default: false,
};
const headOffice = {
  location_id: 'head-office', client_id: 'acme', location_name: 'Head office', is_active: true, is_default: true,
};

function Harness({ clientId, currentLocations = [] as any[] }: { clientId: string | null; currentLocations?: any[] }) {
  const [links, setLinks] = React.useState<ContactLocationInput[]>(
    currentLocations.map((location) => ({ location_id: location.location_id, is_primary: location.is_primary })),
  );
  const [arrangement, setArrangement] = React.useState<any>(null);
  return (
    <ContactLocationsEditor
      clientId={clientId}
      currentLocations={currentLocations}
      workArrangement={arrangement}
      onWorkArrangementChange={setArrangement}
      value={links}
      onChange={setLinks}
    />
  );
}

beforeEach(() => {
  hoisted.getClientLocations.mockReset();
  hoisted.getClientLocations.mockResolvedValue([warehouse, headOffice]);
});

describe('ContactLocationsEditor', () => {
  it('shows the hint and loads nothing until a client is chosen', async () => {
    render(<Harness clientId={null} />);

    expect(screen.getByText('Choose a client first to pick its locations.')).toBeInTheDocument();
    expect(hoisted.getClientLocations).not.toHaveBeenCalled();
  });

  it('lists the client\'s active locations once a client is chosen', async () => {
    render(<Harness clientId="acme" />);

    await waitFor(() => expect(screen.getByText('Head office')).toBeInTheDocument());
    expect(screen.getByText('Warehouse')).toBeInTheDocument();
    expect(hoisted.getClientLocations).toHaveBeenCalledWith('acme');
  });

  it('keeps an inactive already-linked location listed and marked', async () => {
    render(<Harness
      clientId="acme"
      currentLocations={[{ location_id: 'old-depot', location_name: 'Old depot', is_primary: true, is_active: false }]}
    />);

    await waitFor(() => expect(screen.getByText('Old depot')).toBeInTheDocument());
    expect(screen.getByText('(inactive)')).toBeInTheDocument();
  });

  it('offers the primary radio only for selected locations, and moves it on click', async () => {
    render(<Harness clientId="acme" />);
    await waitFor(() => expect(screen.getByText('Warehouse')).toBeInTheDocument());

    expect(screen.queryByText('Primary')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Warehouse'));
    // A lone link is the primary one even though nobody said so.
    await waitFor(() => expect(screen.getByRole('radio')).toBeChecked());

    fireEvent.click(screen.getByLabelText('Head office'));
    await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(2));
    const [headOfficeRadio, warehouseRadio] = screen.getAllByRole('radio');
    void headOfficeRadio;
    expect(warehouseRadio).toBeChecked();

    fireEvent.click(headOfficeRadio);
    await waitFor(() => expect(headOfficeRadio).toBeChecked());
    expect(warehouseRadio).not.toBeChecked();
  });
});

describe('selection helpers', () => {
  it('makes a lone link primary and never keeps two', () => {
    expect(normalizeContactLocationSelection([{ location_id: 'a' }]))
      .toEqual([{ location_id: 'a', is_primary: true }]);
    expect(normalizeContactLocationSelection([
      { location_id: 'a', is_primary: true },
      { location_id: 'b', is_primary: true },
    ])).toEqual([
      { location_id: 'a', is_primary: true },
      { location_id: 'b', is_primary: false },
    ]);
  });

  it('reports a two-primary selection as a validation failure', () => {
    expect(contactLocationSelectionError([
      { location_id: 'a', is_primary: true },
      { location_id: 'b', is_primary: true },
    ])).toBe('multiplePrimary');
    expect(contactLocationSelectionError([{ location_id: 'a', is_primary: true }])).toBeNull();
  });
});
