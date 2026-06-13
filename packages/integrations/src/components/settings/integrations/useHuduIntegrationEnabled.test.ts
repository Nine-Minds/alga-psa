import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useFeatureFlagMock = vi.fn();
const isCalendarEnterpriseEditionMock = vi.fn();

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: useFeatureFlagMock,
}));

vi.mock('../../../lib/calendarAvailability', () => ({
  isCalendarEnterpriseEdition: isCalendarEnterpriseEditionMock,
}));

async function importHook() {
  return import('./useHuduIntegrationEnabled');
}

describe('T002: useHuduIntegrationEnabled', () => {
  beforeEach(() => {
    vi.resetModules();
    useFeatureFlagMock.mockReset();
    isCalendarEnterpriseEditionMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns enabled=false by default when the flag is absent (defaults off)', async () => {
    // EE detected, but the flag has never been set => useFeatureFlag yields its
    // defaultValue of false.
    isCalendarEnterpriseEditionMock.mockReturnValue(true);
    useFeatureFlagMock.mockReturnValue({ enabled: false, loading: false, error: null });

    const { useHuduIntegrationEnabled } = await importHook();
    const result = useHuduIntegrationEnabled();

    expect(result.enabled).toBe(false);
    // The hook asks for the hudu-integration flag with a false default.
    expect(useFeatureFlagMock).toHaveBeenCalledWith('hudu-integration', { defaultValue: false });
  });

  it('returns enabled=false in CE even if the flag is somehow on', async () => {
    isCalendarEnterpriseEditionMock.mockReturnValue(false);
    useFeatureFlagMock.mockReturnValue({ enabled: true, loading: false, error: null });

    const { useHuduIntegrationEnabled } = await importHook();

    expect(useHuduIntegrationEnabled().enabled).toBe(false);
  });

  it('returns enabled=true only when EE and the flag are both on', async () => {
    isCalendarEnterpriseEditionMock.mockReturnValue(true);
    useFeatureFlagMock.mockReturnValue({ enabled: true, loading: false, error: null });

    const { useHuduIntegrationEnabled } = await importHook();

    expect(useHuduIntegrationEnabled().enabled).toBe(true);
  });

  it('surfaces the underlying flag loading state', async () => {
    isCalendarEnterpriseEditionMock.mockReturnValue(true);
    useFeatureFlagMock.mockReturnValue({ enabled: false, loading: true, error: null });

    const { useHuduIntegrationEnabled } = await importHook();

    expect(useHuduIntegrationEnabled().loading).toBe(true);
  });
});
