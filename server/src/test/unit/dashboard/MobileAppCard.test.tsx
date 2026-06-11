/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toDataURLMock = vi.hoisted(() => vi.fn(async () => 'data:image/png;base64,MOCK'));
vi.mock('qrcode', () => ({
  default: { toDataURL: toDataURLMock },
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

import MobileAppCard from '../../../components/dashboard/MobileAppCard';

describe('MobileAppCard', () => {
  beforeEach(() => {
    toDataURLMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('always renders the store download QRs', async () => {
    render(<MobileAppCard onDismiss={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByAltText(/Apple App Store/)).toBeInTheDocument();
      expect(screen.getByAltText(/Google Play/)).toBeInTheDocument();
    });
    expect(toDataURLMock).toHaveBeenCalledWith('https://apps.apple.com/app/id6760326836', expect.anything());
    expect(toDataURLMock).toHaveBeenCalledWith(
      'https://play.google.com/store/apps/details?id=com.alga.psa.mobile',
      expect.anything(),
    );
  });

  it('hides the connect-this-server QR when not self-hosted', async () => {
    render(<MobileAppCard onDismiss={() => undefined} selfHost={false} />);

    await waitFor(() => {
      expect(screen.getByAltText(/Apple App Store/)).toBeInTheDocument();
    });
    expect(screen.queryByTestId('connect-server-qr')).not.toBeInTheDocument();
    expect(toDataURLMock).toHaveBeenCalledTimes(2);
  });

  it('renders the connect-this-server QR encoding this origin when self-hosted', async () => {
    render(<MobileAppCard onDismiss={() => undefined} selfHost />);

    await waitFor(() => {
      expect(screen.getByTestId('connect-server-qr')).toBeInTheDocument();
      expect(screen.getByText('Connect this server')).toBeInTheDocument();
    });
    expect(toDataURLMock).toHaveBeenCalledWith(
      `alga://server?url=${encodeURIComponent(window.location.origin)}`,
      expect.anything(),
    );
  });
});
