import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const contactDetailsSource = readFileSync(
  new URL('./ContactDetails.tsx', import.meta.url),
  'utf8'
);

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
    expect(contactDetailsSource).toContain('id="contact-inbound-ticket-destination-select"');
    expect(contactDetailsSource).toContain("value={(editedContact as any).inbound_ticket_defaults_id || ''}");
    expect(contactDetailsSource).toContain("onValueChange={(value) => handleFieldChange('inbound_ticket_defaults_id', value)}");
    expect(contactDetailsSource).toContain('allowClear={true}');
    expect(contactDetailsSource).toContain('const updatedContact = await updateContact(dataToUpdate);');

    expect(contactDetailsEditSource).toContain("id={`${id}-inbound-ticket-destination-select`}");
    expect(contactDetailsEditSource).toContain("value={(contact as any).inbound_ticket_defaults_id || ''}");
    expect(contactDetailsEditSource).toContain("onValueChange={(value) => handleInputChange('inbound_ticket_defaults_id', value)}");
    expect(contactDetailsEditSource).toContain('allowClear={true}');
    expect(contactDetailsEditSource).toContain('onSave(updatedContact);');

    // updateContact validates a submitted override against inbound_ticket_defaults
    // and surfaces a FOREIGN_KEY_ERROR when the destination no longer exists.
    expect(contactActionsSource).toContain(
      'const inboundDestinationIdRaw = (contactData as any).inbound_ticket_defaults_id;'
    );
    expect(contactActionsSource).toContain(
      "throw new Error('FOREIGN_KEY_ERROR: The selected inbound ticket destination no longer exists');"
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
