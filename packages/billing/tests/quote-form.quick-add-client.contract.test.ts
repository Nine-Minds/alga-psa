/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return fs.readFileSync(
    path.resolve(__dirname, '../src/components/billing-dashboard/quotes/QuoteForm.tsx'),
    'utf8',
  );
}

describe('quote form client creation wiring contract', () => {
  it('offers quick-add only while editable and atomically selects an upserted client', () => {
    const source = readSource();

    expect(source).toContain(
      'onAddNew={!isReadOnly ? () => setIsQuickAddClientOpen(true) : undefined}',
    );
    expect(source).toContain('open: isQuickAddClientOpen,');
    expect(source).toContain('onOpenChange: setIsQuickAddClientOpen,');
    expect(source).toContain('skipSuccessDialog: true,');
    expect(source).toContain(
      '(client) => client.client_id === newClient.client_id,',
    );
    expect(source).toContain('nextClients[existingIndex] = newClient;');
    expect(source).toContain(`setForm((current) => ({
            ...current,
            client_id: newClient.client_id,
            contact_id: '',
            // Only a new quote without a source template adopts the created
            // client's default currency; editing keeps the saved currency and a
            // template keeps its own.
            ...(isEditMode || form.source_template_id
              ? {}
              : { currency_code: newClient.default_currency_code || defaultCurrency }),
          }));`);
    expect(source).toContain(`if (!isEditMode && !form.source_template_id) {
            setCurrencySource('client');
          }`);
  });
});
