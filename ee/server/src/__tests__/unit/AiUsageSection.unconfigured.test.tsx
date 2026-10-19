// @vitest-environment jsdom
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAiAccountSummary: vi.fn(),
  getAiUsageHistory: vi.fn(),
  getAiTopupPacks: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: { error: mocks.toastError, success: vi.fn() },
}));
// `t` must be referentially stable: the component lists it in effect deps.
const stableT = (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key;
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: stableT }),
}));
vi.mock('../../lib/actions/aiUsageActions', () => ({
  getAiAccountSummary: mocks.getAiAccountSummary,
  getAiUsageHistory: mocks.getAiUsageHistory,
  getAiTopupPacks: mocks.getAiTopupPacks,
  setAiAutoTopup: vi.fn(),
  startAiAddonCheckout: vi.fn(),
  startAiTopupCheckout: vi.fn(),
}));

import AiUsageSection from '../../components/settings/account/AiUsageSection';

describe('AiUsageSection when the AI gateway is unavailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAiTopupPacks.mockResolvedValue([]);
    mocks.getAiAccountSummary.mockResolvedValue({ status: 'unavailable', reason: 'not_configured' });
  });

  it('renders nothing and shows no error toast', async () => {
    const { container } = render(<AiUsageSection />);
    await waitFor(() => expect(mocks.getAiAccountSummary).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('#ai-usage-section')).toBeNull());
    expect(container).toBeEmptyDOMElement();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.getAiUsageHistory).not.toHaveBeenCalled();
  });
});
