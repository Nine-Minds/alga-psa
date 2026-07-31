import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const isCalendarEnterpriseEditionMock = vi.fn();

vi.mock('../../../lib/calendarAvailability', () => ({
  isCalendarEnterpriseEdition: isCalendarEnterpriseEditionMock,
}));

async function importHook() {
  return import('./useHuduIntegrationEnabled');
}

describe('T002: useHuduIntegrationEnabled', () => {
  beforeEach(() => {
    vi.resetModules();
    isCalendarEnterpriseEditionMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns enabled=true in EE', async () => {
    isCalendarEnterpriseEditionMock.mockReturnValue(true);

    const { useHuduIntegrationEnabled } = await importHook();

    expect(useHuduIntegrationEnabled().enabled).toBe(true);
  });

  it('returns enabled=false in CE', async () => {
    isCalendarEnterpriseEditionMock.mockReturnValue(false);

    const { useHuduIntegrationEnabled } = await importHook();

    expect(useHuduIntegrationEnabled().enabled).toBe(false);
  });

  it('never reports a loading state', async () => {
    isCalendarEnterpriseEditionMock.mockReturnValue(true);

    const { useHuduIntegrationEnabled } = await importHook();

    expect(useHuduIntegrationEnabled().loading).toBe(false);
  });
});
