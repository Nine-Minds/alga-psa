// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: (namespace: string) => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      const translations: Record<string, string> = {
        'msp/core:nav.interactions': 'Localized Interactions',
        'msp/core:settings.tabs.interactions': 'Localized interaction feed',
        'msp/integrations:integrations.telephony.callsPanel.title': 'Localized calls',
      };
      return translations[`${namespace}:${key}`] ?? options?.defaultValue ?? key;
    },
  }),
}));

vi.mock('./OverallInteractionsFeed', () => ({
  default: () => <div data-testid="interactions-feed" />,
}));

import InteractionsWorkspace from './InteractionsWorkspace';

describe('InteractionsWorkspace', () => {
  afterEach(cleanup);

  it('keeps the interaction feed expanded and switches to the calls surface', () => {
    render(
      <InteractionsWorkspace
        users={[]}
        contacts={[]}
        clients={[]}
        callsPanel={<div>Phone call workspace</div>}
      />,
    );

    expect(screen.getByTestId('interactions-feed')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Localized Interactions' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Localized interaction feed' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Localized calls' }));
    expect(screen.getByText('Phone call workspace')).toBeTruthy();
  });

  it('does not advertise calls when telephony is unavailable', () => {
    render(<InteractionsWorkspace users={[]} contacts={[]} clients={[]} />);

    expect(screen.queryByRole('tab', { name: 'Localized calls' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Localized interaction feed' })).toBeTruthy();
  });
});
