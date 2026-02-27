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
    expect(contactDetailsEditSource).toContain("name=\"inbound_ticket_defaults_id\"");
    expect(contactDetailsEditSource).toContain('allowClear={true}');
    expect(contactDetailsEditSource).toContain('await onSave(updatedData);');

    expect(contactActionsSource).toContain("'role', 'notes', 'inbound_ticket_defaults_id' as keyof IContact");
    expect(contactActionsSource).toContain(
      "if ((key === 'client_id' || key === 'inbound_ticket_defaults_id') && value === '') {"
    );
    expect(contactActionsSource).toContain(
      "throw new Error('FOREIGN_KEY_ERROR: The selected inbound ticket destination no longer exists');"
    );
  });
});
