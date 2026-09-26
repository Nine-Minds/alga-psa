// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MigrationJobDetails } from '../../../lib/migrations/types';

type SelectOption = { value: string; label: string };

const actions = vi.hoisted(() => ({ getOptions: vi.fn(), saveConfiguration: vi.fn() }));
vi.mock('@/lib/migrations/migrationActions', () => ({
  getMigrationConfigurationOptions: actions.getOptions,
  saveMigrationConfiguration: actions.saveConfiguration,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, options, value, onValueChange, placeholder, allowClear }: {
    id: string;
    options: SelectOption[];
    value: string;
    onValueChange: (value: string) => void;
    placeholder?: string;
    allowClear?: boolean;
  }) => (
    <select id={id} value={value} onChange={(event) => onValueChange(event.target.value)}>
      <option value="">{allowClear ? "Don't import" : placeholder}</option>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Spinner', () => ({ default: () => <span>Loading</span> }));
vi.mock('@alga-psa/ui/components/Alert', () => ({ Alert: ({ children }: { children: React.ReactNode }) => <div role="alert">{children}</div>, AlertDescription: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock('@alga-psa/ui/components/Label', () => ({ Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => <label {...props}>{children}</label> }));

import { seedCustomAssetFieldMappings } from '../../../components/settings/migrations/MigrationConfigurePanel';
import MigrationConfigurePanel from '../../../components/settings/migrations/MigrationConfigurePanel';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function elementById(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Expected element #${id} to be rendered`);
  return element;
}

const assetTypes = [
  { slug: 'workstation', name: 'Workstation', isBuiltin: true, fields: [] },
  { slug: 'door_access', name: 'Door Access', isBuiltin: false, fields: [{ key: 'door_count', label: 'Door Count', kind: 'number', required: false }] },
] as never;
const sourceFields = [
  { assetTypeName: 'Workstation', fieldName: 'Door Count', sampleValue: '3', recordCount: 1 },
  { assetTypeName: 'Door Access', fieldName: 'Door Count', sampleValue: '3', recordCount: 1 },
] as never;

describe('custom asset field configuration defaults', () => {
  it('keeps built-in imports free of custom mappings when reopening and preparing to save', () => {
    expect(seedCustomAssetFieldMappings(
      { Workstation: 'workstation' },
      { workstation: {} },
      assetTypes,
      sourceFields
    )).toEqual({});
  });

  it('matches fields after a fresh custom type selection and preserves saved mappings and explicit clears', () => {
    expect(seedCustomAssetFieldMappings({ 'Door Access': 'door_access' }, {}, assetTypes, sourceFields))
      .toEqual({ door_access: { 'Door Count': 'door_count' } });
    expect(seedCustomAssetFieldMappings(
      { 'Door Access': 'door_access' },
      { door_access: {} },
      assetTypes,
      sourceFields
    )).toEqual({ door_access: {} });
    expect(seedCustomAssetFieldMappings(
      { 'Door Access': 'door_access' },
      { door_access: { 'Door Count': 'custom_key' } },
      assetTypes,
      sourceFields
    )).toEqual({ door_access: { 'Door Count': 'custom_key' } });
  });

  it('removes stale source mappings after remapping and saves only the still-visible mapping', async () => {
    actions.getOptions.mockResolvedValue({
      boards: [], statuses: [], priorities: [], clients: [], users: [],
      assetTypes: [
        { slug: 'door_access', name: 'Door Access', isBuiltin: false, fields: [
          { key: 'count', label: 'Count', kind: 'number', required: false },
          { key: 'description', label: 'Description', kind: 'text', required: false },
        ] },
        { slug: 'workstation', name: 'Workstation', isBuiltin: true, fields: [] },
      ],
      packageStatusNames: [], packagePriorityNames: [], packageAssetTypeNames: ['A', 'B'],
      packageAssetCustomFields: [
        { assetTypeName: 'A', fieldName: 'OldColumn', sampleValue: '1', recordCount: 1 },
        { assetTypeName: 'B', fieldName: 'NewColumn', sampleValue: '2', recordCount: 1 },
        { assetTypeName: 'B', fieldName: 'LeaveBlank', sampleValue: null, recordCount: 1 },
      ],
      stagedEntityTypes: ['assets'],
    });
    actions.saveConfiguration.mockResolvedValue(undefined);
    const details = {
      migrationJobId: 'job-1',
      configuration: { assets: {
        assetTypeMapping: { A: 'door_access', B: 'door_access' },
        customFieldMapping: { door_access: { OldColumn: 'count', NewColumn: 'count', LeaveBlank: 'description' } },
      } },
    } as unknown as MigrationJobDetails;

    render(<MigrationConfigurePanel details={details} onSaved={vi.fn()} />);
    const save = await screen.findByRole('button', { name: 'Save configuration' });
    expect(save).toBeDisabled();
    expect(screen.getByText(/mapped more than once/)).toBeInTheDocument();

    fireEvent.change(elementById('amp-config-asset-fields-door_access-2-select'), { target: { value: '' } });
    expect(save).toBeDisabled();
    fireEvent.change(elementById('amp-config-asset-type-mapping-0-select'), { target: { value: 'workstation' } });

    await waitFor(() => expect(screen.queryByText('OldColumn')).not.toBeInTheDocument());
    expect(screen.getByText('NewColumn')).toBeInTheDocument();
    expect((document.getElementById('amp-config-asset-fields-door_access-1-select') as HTMLSelectElement).value).toBe('');
    expect(screen.queryByText(/mapped more than once/)).not.toBeInTheDocument();
    expect(save).toBeEnabled();

    fireEvent.click(save);
    await waitFor(() => expect(actions.saveConfiguration).toHaveBeenCalledTimes(1));
    expect(actions.saveConfiguration).toHaveBeenCalledWith('job-1', expect.objectContaining({
      assets: {
        assetTypeMapping: { A: 'workstation', B: 'door_access' },
        customFieldMapping: { door_access: { NewColumn: 'count' } },
      },
    }));
  });
});
