import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const contactDetailsEditSource = readFileSync(
  new URL('./ContactDetailsEdit.tsx', import.meta.url),
  'utf8'
);

const contactActionsSource = readFileSync(
  new URL('../../actions/contact-actions/contactActions.tsx', import.meta.url),
  'utf8'
);

describe('Contact inbound destination wiring', () => {
  it('T026: contact UI can set/clear override and persists through updateContact', () => {
    expect(contactDetailsEditSource).toContain("id={`${id}-inbound-ticket-destination-select`}");
    expect(contactDetailsEditSource).toContain("value={(contact as any).inbound_ticket_defaults_id || ''}");
    expect(contactDetailsEditSource).toContain("onValueChange={(value) => handleInputChange('inbound_ticket_defaults_id', value)}");
    expect(contactDetailsEditSource).toContain('allowClear={true}');
    expect(contactDetailsEditSource).toContain('onSave(updatedContact);');

    // updateContact validates a submitted override against inbound_ticket_defaults
    // and surfaces a FOREIGN_KEY_ERROR when the destination no longer exists.
    // The message is localized (server-side translation path), but the
    // FOREIGN_KEY_ERROR prefix and the errors.contact.destinationMissing key
    // it resolves through must still be wired up.
    expect(contactActionsSource).toContain(
      'const inboundDestinationIdRaw = (contactData as any).inbound_ticket_defaults_id;'
    );
    expect(contactActionsSource).toContain(
      "throw await contactError('errors.contact.destinationMissing', 'FOREIGN_KEY_ERROR: ');"
    );

    // Regression guard (BUG-1): the validated override must be PERSISTED through
    // ContactModel.updateContact, not silently dropped. An empty string clears it.
    expect(contactActionsSource).toContain(
      "(contactData as any).inbound_ticket_defaults_id === ''"
    );
    expect(contactActionsSource).toMatch(
      /ContactModel\.updateContact\([\s\S]*inbound_ticket_defaults_id:[\s\S]*\}, tenant, trx\)/
    );
  });
});
