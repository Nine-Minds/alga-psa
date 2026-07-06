/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// RightSidebar resolves the edition from process.env at module load, and
// process.env is fork-global: an earlier test file that set EDITION would
// flip this render onto the lazy enterprise path. Pin CE before the import
// below evaluates.
const savedEdition = vi.hoisted(() => {
  const saved = {
    next: process.env.NEXT_PUBLIC_EDITION,
    plain: process.env.EDITION,
  };
  process.env.NEXT_PUBLIC_EDITION = 'community';
  delete process.env.EDITION;
  return saved;
});

import RightSidebar from '../../../components/layout/RightSidebar';

afterAll(() => {
  if (savedEdition.next === undefined) delete process.env.NEXT_PUBLIC_EDITION;
  else process.env.NEXT_PUBLIC_EDITION = savedEdition.next;
  if (savedEdition.plain !== undefined) process.env.EDITION = savedEdition.plain;
});

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

  it('T048/T049: CE fallback title and enterprise-only copy are translated', async () => {
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

    // findByText: the sidebar body loads asynchronously (spinner first).
    expect(await screen.findByText('Discussion')).toBeInTheDocument();
    expect(screen.getByText('Le chat est reserve a l edition Enterprise.')).toBeInTheDocument();
  });
});
