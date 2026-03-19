/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import RightSidebar from '../../../components/layout/RightSidebar';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      const map: Record<string, string> = {
        'rightSidebar.title': 'Discussion',
        'rightSidebar.enterpriseOnly': 'Le chat est reserve a l edition Enterprise.',
      };
      return map[key] ?? options?.defaultValue ?? key;
    },
  }),
}));

describe('RightSidebar i18n wiring', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: new URL('https://example.test/msp/dashboard'),
    });
  });

  it('T048/T049: CE fallback title and enterprise-only copy are translated', () => {
    render(
      <RightSidebar
        isOpen={true}
        setIsOpen={() => {}}
        clientUrl=""
        accountId=""
        messages={[]}
        userRole=""
        userId={null}
        selectedAccount=""
        handleSelectAccount={() => {}}
        auth_token=""
        setChatTitle={() => {}}
        isTitleLocked={false}
      />
    );

    expect(screen.getByText('Discussion')).toBeInTheDocument();
    expect(screen.getByText('Le chat est reserve a l edition Enterprise.')).toBeInTheDocument();
  });
});
