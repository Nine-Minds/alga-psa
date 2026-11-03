import { describe, expect, it } from 'vitest';

import { composeLinkedAssetInfo, summarizeServerStorage } from './linkedAssetLabelInfo';

const base = {
  asset_id: 'a1',
  asset_type: 'workstation',
  name: 'Dell Latitude 5540',
  manufacturer: 'Dell',
  model: null,
};

describe('composeLinkedAssetInfo', () => {
  it('composes OS/CPU/RAM/storage lines from a workstation extension row', () => {
    const info = composeLinkedAssetInfo(base, {
      os_type: 'Windows 11 Pro',
      os_version: '23H2',
      cpu_model: 'Intel Core i7-1365U',
      cpu_cores: 10,
      ram_gb: 16,
      storage_type: 'SSD',
      storage_capacity_gb: 512,
    });
    expect(info).toEqual({
      assetId: 'a1',
      name: 'Dell Latitude 5540',
      manufacturer: 'Dell',
      model: null,
      osLine: 'Windows 11 Pro 23H2',
      cpuLine: 'Intel Core i7-1365U / 10 cores',
      ramLine: '16 GB',
      storageLine: 'SSD 512 GB',
    });
  });

  it('omits missing parts instead of printing stubs', () => {
    const info = composeLinkedAssetInfo({ ...base, name: '  ', manufacturer: '' }, { cpu_cores: 8 });
    expect(info.name).toBeNull();
    expect(info.manufacturer).toBeNull();
    expect(info.osLine).toBeNull();
    expect(info.cpuLine).toBe('8 cores');
    expect(info.ramLine).toBeNull();
    expect(info.storageLine).toBeNull();
  });

  it('uses the supplied localized formatter for CPU core counts', () => {
    const formatCores = (count: number) => `${count} cœurs`;
    expect(composeLinkedAssetInfo(base, { cpu_model: 'Example CPU', cpu_cores: 8 }, formatCores).cpuLine)
      .toBe('Example CPU / 8 cœurs');
    expect(composeLinkedAssetInfo(base, { cpu_cores: 8 }, formatCores).cpuLine).toBe('8 cœurs');
    expect(composeLinkedAssetInfo(base, { cpu_model: 'Example CPU' }, formatCores).cpuLine).toBe('Example CPU');
    expect(composeLinkedAssetInfo(base, { cpu_cores: 1 }).cpuLine).toBe('1 core');
  });

  it('falls back to the extension model for mobile/printer rows', () => {
    const info = composeLinkedAssetInfo({ ...base, asset_type: 'printer', model: null }, { model: 'M407n' });
    expect(info.model).toBe('M407n');
  });

  it('base columns win over the extension model', () => {
    const info = composeLinkedAssetInfo({ ...base, model: 'Base Model' }, { model: 'Ext Model' });
    expect(info.model).toBe('Base Model');
  });

  it('a type with no extension row still gets the base-only block', () => {
    const info = composeLinkedAssetInfo({ ...base, asset_type: 'unknown', model: 'Widget' }, null);
    expect(info).toMatchObject({ assetId: 'a1', name: 'Dell Latitude 5540', manufacturer: 'Dell', model: 'Widget' });
    expect(info.cpuLine).toBeNull();
  });

  it('summarises free-form server storage_config entries', () => {
    expect(summarizeServerStorage([{ type: 'SSD', size_gb: 960 }, 'RAID1 mirror'])).toBe('SSD 960 GB; RAID1 mirror');
    expect(
      summarizeServerStorage([
        { name: 'C:', capacity_gb: 476, free_gb: 120, file_system: 'NTFS' },
        { name: 'D:', capacity_gb: 1863, free_gb: 900, file_system: 'NTFS' },
      ])
    ).toBe('C: 476 GB NTFS; D: 1863 GB NTFS');
    expect(summarizeServerStorage([])).toBeNull();
    expect(summarizeServerStorage([{ a: { deep: 1 } }])).toBeNull();
    expect(summarizeServerStorage(null)).toBeNull();
    const info = composeLinkedAssetInfo(base, { ram_gb: 64, storage_config: [{ type: 'SSD', size_gb: 960 }] });
    expect(info.storageLine).toBe('SSD 960 GB');
    expect(info.ramLine).toBe('64 GB');
  });
});
