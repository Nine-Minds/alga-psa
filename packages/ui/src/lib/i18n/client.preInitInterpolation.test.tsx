/** @vitest-environment node */

import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.unmock('@alga-psa/ui/lib/i18n/client');

const { useTranslation } = await import('./client');

function Greeting({ name }: { name: string }) {
  const { t } = useTranslation('msp/auth', { useSuspense: false });
  return (
    <p>
      {t('signIn.scopedTenant.signingInTo', { name, defaultValue: 'Signing in to {{name}}' })}
      {' | '}
      {t('plain.key', 'No placeholders')}
      {' | '}
      {t('count.key', { count: 3, defaultValue: '{{count}} items for {{ missing }}' })}
    </p>
  );
}

describe('useTranslation before the i18n instance is initialised', () => {
  it('interpolates {{placeholders}} from the call options into defaultValue', () => {
    const html = renderToString(<Greeting name="Acme MSP" />);

    expect(html).toContain('Signing in to Acme MSP');
    expect(html).toContain('No placeholders');
    expect(html).toContain('3 items for ');
    expect(html).not.toContain('{{');
  });
});
