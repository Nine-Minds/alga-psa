/** @vitest-environment jsdom */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PayloadFieldSelector } from './AdminWebhooksSetup';
import { WEBHOOK_QUOTE_PAYLOAD_FIELDS } from '@/lib/webhooks/payloadFields';

const locales = path.resolve(__dirname, '../../../../public/locales');
const en = JSON.parse(
  readFileSync(path.join(locales, 'en/msp/profile.json'), 'utf8')
);
const t = ((key: string, options?: { defaultValue?: string }) =>
  key.split('.').reduce((v, part) => v?.[part], en) ??
  options?.defaultValue ??
  key) as any;

describe('quote webhook payload field editor', () => {
  it('renders the quote field group from registry events and changes the selected fields', () => {
    const onChange = vi.fn();
    render(
      <PayloadFieldSelector
        selectedEventTypes={['quote.accepted', 'quote.converted']}
        selection={{}}
        onChange={onChange}
        translate={t}
      />
    );
    expect(screen.getByText('Quote')).toBeInTheDocument();
    const checkbox = screen.getByLabelText('Selected optional item IDs');
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({
      quote: WEBHOOK_QUOTE_PAYLOAD_FIELDS.filter(
        (field) => field !== 'selected_optional_item_ids'
      ),
    });
    fireEvent.click(screen.getByText('Clear'));
    expect(onChange).toHaveBeenLastCalledWith({ quote: [] });
  });

  it('provides every selectable quote field label in every locale, including pseudo-locales', () => {
    for (const locale of readdirSync(locales)) {
      const file = path.join(locales, locale, 'msp/profile.json');
      let data;
      try {
        data = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        continue;
      }
      const quote = data.security.webhooks.quotePayload;
      expect(quote.entity, locale).toBeTruthy();
      expect(Object.keys(quote.fields).sort(), locale).toEqual(
        [...WEBHOOK_QUOTE_PAYLOAD_FIELDS].sort()
      );
      for (const field of WEBHOOK_QUOTE_PAYLOAD_FIELDS)
        expect(quote.fields[field], `${locale}.${field}`).toBeTruthy();
      if (locale === 'xx' || locale === 'yy')
        expect(quote.entity).not.toBe('Quote');
    }
  });
});
