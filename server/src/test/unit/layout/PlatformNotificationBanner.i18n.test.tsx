/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PlatformNotificationBanner } from '../../../components/layout/PlatformNotificationBanner';

const getActivePlatformNotifications = vi.fn();
const dismissPlatformNotification = vi.fn();

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@enterprise/lib/platformNotifications/actions', () => ({
  getActivePlatformNotifications: (...args: unknown[]) => getActivePlatformNotifications(...args),
  dismissPlatformNotification: (...args: unknown[]) => dismissPlatformNotification(...args),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      const map: Record<string, string> = {
        'banners.platformNotification.learnMore': 'En savoir plus',
        'banners.platformNotification.dismiss': 'Ignorer la notification',
      };
      return map[key] ?? options?.defaultValue ?? key;
    },
  }),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({
    children,
    onClick,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('PlatformNotificationBanner i18n wiring', () => {
  beforeEach(() => {
    getActivePlatformNotifications.mockReset();
    dismissPlatformNotification.mockReset();
    getActivePlatformNotifications.mockResolvedValue([
      {
        notification_id: 'notif-1',
        title: 'Title',
        banner_content: '<strong>Body</strong>',
        variant: 'info',
      },
    ]);
  });

  it('T050/T051: learn-more button text and dismiss aria-label are translated', async () => {
    render(<PlatformNotificationBanner />);

    await waitFor(() => {
      expect(screen.getByText('En savoir plus')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Ignorer la notification' }));

    await waitFor(() => {
      expect(dismissPlatformNotification).toHaveBeenCalledWith('notif-1');
    });
  });
});
