import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const clientDetailsSource = readFileSync(
  new URL('./ClientDetails.tsx', import.meta.url),
  'utf8'
);

const clientActionsSource = readFileSync(
  new URL('../../actions/clientActions.ts', import.meta.url),
  'utf8'
);

describe('ClientDetails inbound destination wiring', () => {
  it('T025: UI can set/clear inbound destination and persists through updateClient', () => {
    expect(clientDetailsSource).toContain('id="client-inbound-ticket-destination-select"');
    expect(clientDetailsSource).toContain("value={editedClient.inbound_ticket_defaults_id || ''}");
    expect(clientDetailsSource).toContain("onValueChange={(value) => handleFieldChange('inbound_ticket_defaults_id', value)}");
    expect(clientDetailsSource).toContain('allowClear={true}');
    expect(clientDetailsSource).toContain("const updatedClientResult = await updateClient(client.client_id, dataToUpdate);");

    expect(clientActionsSource).toContain(
      "updateObject[key] = (value === undefined || value === '') ? null : value;"
    );
  });
});
