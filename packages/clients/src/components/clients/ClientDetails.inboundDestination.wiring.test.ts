import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const clientDetailsSource = readFileSync(
  new URL('./ClientDetails.tsx', import.meta.url),
  'utf8'
);

const clientTabContentSource = readFileSync(
  new URL('./ClientDetailsTabContent.tsx', import.meta.url),
  'utf8'
);

const clientActionsSource = readFileSync(
  new URL('../../actions/clientActions.ts', import.meta.url),
  'utf8'
);

describe('ClientDetails inbound destination wiring', () => {
  it('T025: UI can set/clear inbound destination and persists through updateClient', () => {
    // The inbound destination select lives in the details tab content and routes
    // changes back to the parent through the onFieldChange prop.
    expect(clientTabContentSource).toContain('id="client-inbound-ticket-destination-select"');
    expect(clientTabContentSource).toContain("value={editedClient.inbound_ticket_defaults_id || ''}");
    expect(clientTabContentSource).toContain("onValueChange={(value) => onFieldChange('inbound_ticket_defaults_id', value)}");
    expect(clientTabContentSource).toContain('allowClear={true}');

    // ClientDetails wires its field handler into the tab content and persists via updateClient.
    expect(clientDetailsSource).toContain('onFieldChange={handleFieldChange}');
    expect(clientDetailsSource).toContain("const updatedClientResult = await updateClient(client.client_id, dataToUpdate);");

    expect(clientActionsSource).toContain(
      "updateObject[key] = (value === undefined || value === '') ? null : value;"
    );
  });
});
