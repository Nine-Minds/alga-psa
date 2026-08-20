/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountingMappingModuleView } from './AccountingMappingModuleView';
import type { AccountingMappingModule } from './types';

const loadMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();

function buildModule(overrides: Partial<AccountingMappingModule> = {}): AccountingMappingModule {
  return {
    id: 'qbo-live-taxcode-mappings',
    adapterType: 'quickbooks_online',
    algaEntityType: 'tax_code',
    externalEntityType: 'TaxCode',
    labels: {
      tab: 'Tax Codes',
      description: 'Map Alga tax regions to QuickBooks tax codes.',
      addButton: 'Add Tax Code Mapping',
      algaColumn: 'Alga Tax Region',
      externalColumn: 'QuickBooks Tax Code',
      dialog: {
        addTitle: 'Add Tax Code Mapping',
        editTitle: 'Edit Tax Code Mapping',
        algaField: 'Alga Tax Region',
        externalField: 'QuickBooks Tax Code'
      },
      deleteConfirmation: {
        title: 'Delete mapping',
        message: ({ externalName }: { externalName?: string }) =>
          `Delete the mapping to ${externalName ?? 'this tax code'}?`
      }
    },
    load: loadMock,
    create: createMock,
    update: updateMock,
    remove: vi.fn(),
    ...overrides
  } as unknown as AccountingMappingModule;
}

const context = { realmId: 'realm-123', connectionId: 'conn-1' };

describe('AccountingMappingModuleView external label rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the live catalog label when the external id is present in the catalog', async () => {
    loadMock.mockResolvedValue({
      mappings: [
        {
          id: 'mapping-1',
          alga_entity_id: 'US-NY',
          external_entity_id: '4',
          metadata: { externalDisplayName: 'stale label' }
        }
      ],
      algaEntities: [{ id: 'US-NY', name: 'New York' }],
      externalEntities: [{ id: '4', name: 'CA-Santa Clara (9.125%)' }]
    });

    render(<AccountingMappingModuleView module={buildModule()} context={context} />);

    // The catalog is the current truth and must win over the saved label.
    expect(await screen.findByText('CA-Santa Clara (9.125%)')).toBeInTheDocument();
    expect(screen.queryByText('stale label')).not.toBeInTheDocument();
  });

  it('falls back to the saved display name when the catalog no longer carries the id', async () => {
    // This is the reported bug: a QuickBooks tax code id such as "101" is
    // meaningless to a user, and it is exactly what showed before the fallback.
    loadMock.mockResolvedValue({
      mappings: [
        {
          id: 'mapping-1',
          alga_entity_id: 'US-NM',
          external_entity_id: '101',
          metadata: { externalDisplayName: 'NM-Roosevelt-Roosevelt (5.5%)' }
        }
      ],
      algaEntities: [{ id: 'US-NM', name: 'New Mexico' }],
      externalEntities: []
    });

    render(<AccountingMappingModuleView module={buildModule()} context={context} />);

    expect(await screen.findByText('NM-Roosevelt-Roosevelt (5.5%)')).toBeInTheDocument();
    expect(screen.queryByText('101')).not.toBeInTheDocument();
  });

  it('keeps the AST pseudo codes readable after the catalog stops offering them', async () => {
    loadMock.mockResolvedValue({
      mappings: [
        {
          id: 'mapping-1',
          alga_entity_id: 'US-NY',
          external_entity_id: 'TAX',
          metadata: { externalDisplayName: 'TAX — taxable (Automated Sales Tax picks the rate)' }
        }
      ],
      algaEntities: [{ id: 'US-NY', name: 'New York' }],
      externalEntities: []
    });

    render(<AccountingMappingModuleView module={buildModule()} context={context} />);

    expect(
      await screen.findByText('TAX — taxable (Automated Sales Tax picks the rate)')
    ).toBeInTheDocument();
  });

  it('falls back to the raw id only when nothing readable was ever stored', async () => {
    loadMock.mockResolvedValue({
      mappings: [
        { id: 'mapping-1', alga_entity_id: 'US-NY', external_entity_id: '175', metadata: null }
      ],
      algaEntities: [{ id: 'US-NY', name: 'New York' }],
      externalEntities: []
    });

    render(<AccountingMappingModuleView module={buildModule()} context={context} />);

    expect(await screen.findByText('175')).toBeInTheDocument();
  });

  it('ignores a blank stored display name rather than rendering empty space', async () => {
    loadMock.mockResolvedValue({
      mappings: [
        {
          id: 'mapping-1',
          alga_entity_id: 'US-NY',
          external_entity_id: '175',
          metadata: { externalDisplayName: '   ' }
        }
      ],
      algaEntities: [{ id: 'US-NY', name: 'New York' }],
      externalEntities: []
    });

    render(<AccountingMappingModuleView module={buildModule()} context={context} />);

    expect(await screen.findByText('175')).toBeInTheDocument();
  });

  it('waits for the catalog before rendering, then shows the enriched label', async () => {
    loadMock.mockResolvedValue({
      mappings: [
        { id: 'mapping-1', alga_entity_id: 'US-NY', external_entity_id: '4', metadata: null }
      ],
      algaEntities: [{ id: 'US-NY', name: 'New York' }],
      externalEntities: [{ id: '4', name: 'NY State (8.875%)' }]
    });

    render(<AccountingMappingModuleView module={buildModule()} context={context} />);

    await waitFor(() => expect(loadMock).toHaveBeenCalled());
    expect(await screen.findByText('NY State (8.875%)')).toBeInTheDocument();
  });
});

describe('AccountingMappingModuleView metadata handling on save', () => {
  beforeAll(() => {
    // Radix dropdown interaction helpers missing in jsdom. defineProperty, not
    // assignment: another suite may have stubbed these non-writable already.
    for (const [name, impl] of [
      ['hasPointerCapture', vi.fn(() => false)],
      ['releasePointerCapture', vi.fn()],
      ['scrollIntoView', vi.fn()],
    ] as const) {
      Object.defineProperty(HTMLElement.prototype, name, {
        value: impl,
        configurable: true,
        writable: true,
      });
    }

    // The dialog's save button submits via form.requestSubmit().
    if (!HTMLFormElement.prototype.requestSubmit) {
      Object.defineProperty(HTMLFormElement.prototype, 'requestSubmit', {
        value(this: HTMLFormElement) {
          this.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        },
        configurable: true,
        writable: true,
      });
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    updateMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  /** Opens the row's edit dialog through the actions menu. */
  async function openEditDialog() {
    const trigger = (await screen.findAllByRole('button')).find(
      (button) => button.getAttribute('aria-haspopup') === 'menu'
    );
    expect(trigger).toBeDefined();
    trigger!.focus();
    fireEvent.keyDown(trigger!, { key: 'Enter', code: 'Enter' });

    const editItem = await screen.findByRole('menuitem', { name: /^Edit$/i });
    fireEvent.click(editItem);
    return screen.findByRole('button', { name: /Save Mapping/i });
  }

  it('clears metadata when the JSON editor is emptied', async () => {
    // The editor is seeded from the stored row, so an emptied editor is a real
    // request to clear — not the "no opinion" that a module without the editor
    // reports. The external id is absent from the catalog so no display name is
    // re-added on top.
    loadMock.mockResolvedValue({
      mappings: [
        {
          id: 'mapping-1',
          alga_entity_id: 'US-NY',
          external_entity_id: '101',
          metadata: { classId: 'CLASS-1' }
        }
      ],
      algaEntities: [{ id: 'US-NY', name: 'New York' }],
      externalEntities: []
    });

    render(
      <AccountingMappingModuleView
        module={buildModule({ metadata: { enableJsonEditor: true } } as Partial<AccountingMappingModule>)}
        context={context}
      />
    );

    const save = await openEditDialog();

    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea.value).toContain('CLASS-1');
    fireEvent.change(textarea, { target: { value: '' } });

    fireEvent.click(save);

    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(updateMock.mock.calls[0][2]).toEqual({
      externalEntityId: '101',
      metadata: null
    });
  });

  it('leaves stored metadata alone when the module has no JSON editor', async () => {
    // Without the editor the dialog always reports null. Sending that through
    // would erase module-owned keys the user never had a chance to resend.
    loadMock.mockResolvedValue({
      mappings: [
        {
          id: 'mapping-1',
          alga_entity_id: 'US-NY',
          external_entity_id: '101',
          metadata: { chargeLineMappings: [{ chargeId: 'c1', qboLineId: '1' }] }
        }
      ],
      algaEntities: [{ id: 'US-NY', name: 'New York' }],
      externalEntities: []
    });

    render(<AccountingMappingModuleView module={buildModule()} context={context} />);

    const save = await openEditDialog();
    expect(document.querySelector('textarea')).toBeNull();

    fireEvent.click(save);

    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(updateMock.mock.calls[0][2]).toEqual({
      externalEntityId: '101',
      metadata: { chargeLineMappings: [{ chargeId: 'c1', qboLineId: '1' }] }
    });
  });

  it('stamps the chosen label onto metadata when the option is in the catalog', async () => {
    loadMock.mockResolvedValue({
      mappings: [
        {
          id: 'mapping-1',
          alga_entity_id: 'US-NY',
          external_entity_id: '4',
          metadata: { classId: 'CLASS-1' }
        }
      ],
      algaEntities: [{ id: 'US-NY', name: 'New York' }],
      externalEntities: [{ id: '4', name: 'NY State (8.875%)' }]
    });

    render(
      <AccountingMappingModuleView
        module={buildModule({ metadata: { enableJsonEditor: true } } as Partial<AccountingMappingModule>)}
        context={context}
      />
    );

    const save = await openEditDialog();
    fireEvent.click(save);

    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(updateMock.mock.calls[0][2]).toEqual({
      externalEntityId: '4',
      metadata: { classId: 'CLASS-1', externalDisplayName: 'NY State (8.875%)' }
    });
  });
});
