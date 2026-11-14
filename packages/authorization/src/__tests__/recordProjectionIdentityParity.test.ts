import { describe, expect, it } from 'vitest';
import {
  ASSET_RECORD_SOURCE,
  PROJECT_RECORD_SOURCE,
  QUOTE_RECORD_SOURCE,
  TICKET_RECORD_SOURCE,
  projectRecord,
  projectRecordByRedactions,
} from '../recordProjectionDescriptors';

describe('canonical identity suppression across projection APIs', () => {
  it.each([
    ['project', PROJECT_RECORD_SOURCE, { project_id: 'p-1', project_number: 'P-1', project_name: 'Visible' }, 'project_number'],
    ['ticket', TICKET_RECORD_SOURCE, { ticket_id: 't-1', ticket_number: 'T-1', title: 'Visible' }, 'ticket_number'],
    ['quote', QUOTE_RECORD_SOURCE, { quote_id: 'q-1', quote_number: 'Q-1', title: 'Visible' }, 'quote_number'],
    ['asset', ASSET_RECORD_SOURCE, { asset_id: 'a-1', asset_tag: 'A-1', name: 'Visible' }, 'asset_tag'],
  ] as const)('suppresses %s under its canonical human identity alias', (resource, source, row, identity) => {
    expect(projectRecord(resource, row, [])).not.toBeNull();
    expect(projectRecordByRedactions([], row, source)).not.toBeNull();

    expect(projectRecord(resource, row, [identity])).toBeNull();
    expect(projectRecordByRedactions([identity], row, source)).toBeNull();
  });
});
