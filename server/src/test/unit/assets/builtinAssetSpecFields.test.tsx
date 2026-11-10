// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AssetSpecSelect, BuiltinAssetSpecFields } from '@alga-psa/ui/components/BuiltinAssetSpecFields';
import { type AssetSpecValues } from '@alga-psa/core/builtinAssetSpecs';
import { buildDefaultAssetExtension } from '@alga-psa/inventory/lib/assetDefaultMetadata';
import type CustomSelect from '@alga-psa/ui/components/CustomSelect';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));
vi.mock('@alga-psa/ui/ui-reflection/useRegisterUIComponent', () => ({
  useRegisterUIComponent: () => undefined,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, options, onValueChange }: React.ComponentProps<typeof CustomSelect>) => (
    <select id={id} value={value ?? ''} onChange={(event) => onValueChange(event.target.value)}>
      <option value="">Select</option>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));

afterEach(cleanup);

function ProductSpecs({ assetType }: { assetType: string }) {
  const [values, setValues] = useState<AssetSpecValues>({});
  return <>
    <BuiltinAssetSpecFields assetType={assetType} values={values} idPrefix="product-spec"
      onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))} />
    <output data-testid="extension">{JSON.stringify(buildDefaultAssetExtension(assetType, values))}</output>
  </>;
}

describe.each(['light', 'dark'])('shared builtin asset specs (%s theme)', (theme) => {
  beforeEach(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  });
  afterEach(() => document.documentElement.classList.remove('dark'));
  it('uses the same OS options in the asset select and product defaults and delivers all workstation fields', () => {
    render(<>
      <AssetSpecSelect id="asset-os" optionGroup="os" value="" onValueChange={vi.fn()} />
      <ProductSpecs assetType="workstation" />
    </>);
    const productOs = screen.getByLabelText('OS Type');
    const assetOs = document.getElementById('asset-os') as HTMLSelectElement;
    expect(Array.from((productOs as HTMLSelectElement).options).map((option) => [option.value, option.text]))
      .toEqual(Array.from(assetOs.options).map((option) => [option.value, option.text]));
    fireEvent.change(productOs, { target: { value: 'windows' } });
    fireEvent.change(screen.getByLabelText('OS Version'), { target: { value: '11' } });
    fireEvent.change(screen.getByLabelText('CPU Model'), { target: { value: 'Core Ultra' } });
    fireEvent.change(screen.getByLabelText('CPU Cores'), { target: { value: '16' } });
    fireEvent.change(screen.getByLabelText('RAM (GB)'), { target: { value: '32' } });
    fireEvent.change(screen.getByLabelText('Storage Type'), { target: { value: 'ssd' } });
    fireEvent.change(screen.getByLabelText('Storage Capacity (GB)'), { target: { value: '1024' } });
    fireEvent.change(screen.getByLabelText('GPU Model'), { target: { value: 'RTX 5070' } });
    expect(JSON.parse(screen.getByTestId('extension').textContent!)).toMatchObject({
      os_type: 'windows', os_version: '11', cpu_model: 'Core Ultra', cpu_cores: 16,
      ram_gb: 32, storage_type: 'ssd', storage_capacity_gb: 1024, gpu_model: 'RTX 5070',
    });
  });

  it('keeps network capabilities boolean and power draw decimal', () => {
    render(<ProductSpecs assetType="network_device" />);
    fireEvent.change(screen.getByLabelText('Device Type'), { target: { value: 'firewall' } });
    fireEvent.change(screen.getByLabelText('Port Count'), { target: { value: '24' } });
    fireEvent.change(screen.getByLabelText('Power Draw (Watts)'), { target: { value: '12.5' } });
    fireEvent.click(screen.getByLabelText('Supports PoE'));
    expect(JSON.parse(screen.getByTestId('extension').textContent!)).toMatchObject({
      device_type: 'firewall', port_count: 24, power_draw_watts: 12.5, supports_poe: true,
    });
  });

  it('shows the server hypervisor only for virtual machines', () => {
    render(<ProductSpecs assetType="server" />);
    expect(screen.queryByLabelText('Hypervisor')).toBeNull();
    fireEvent.click(screen.getByLabelText('Virtual Machine'));
    fireEvent.change(screen.getByLabelText('Hypervisor'), { target: { value: 'Hyper-V' } });
    expect(JSON.parse(screen.getByTestId('extension').textContent!)).toMatchObject({ is_virtual: true, hypervisor: 'Hyper-V' });
  });
});
