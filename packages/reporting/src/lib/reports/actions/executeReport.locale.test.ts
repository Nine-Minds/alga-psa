import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/tenancy/actions', () => ({
  getHierarchicalLocaleAction: vi.fn(async () => 'fr'),
}));

vi.mock('../core/ReportEngine', () => ({
  ReportEngine: {
    execute: vi.fn(async () => ({ reportId: 'r', metrics: {} })),
  },
}));

vi.mock('../core/ReportRegistry', () => ({
  ReportRegistry: {
    get: vi.fn(() => ({ id: 'r', name: 'R', version: 1, category: 'c', metrics: [] })),
  },
}));

import { executeReport } from './executeReport';
import { ReportEngine } from '../core/ReportEngine';

const executeMock = ReportEngine.execute as ReturnType<typeof vi.fn>;

describe('executeReport locale resolution', () => {
  it('passes the hierarchically-resolved locale when none is provided', async () => {
    await executeReport({ reportId: 'r' });
    const options = executeMock.mock.calls.at(-1)![2];
    expect(options.locale).toBe('fr');
  });

  it('lets an explicitly passed locale win', async () => {
    await executeReport({ reportId: 'r', options: { locale: 'de' } });
    const options = executeMock.mock.calls.at(-1)![2];
    expect(options.locale).toBe('de');
  });
});
