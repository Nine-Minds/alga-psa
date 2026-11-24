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

  it.each(['project', 'fields.project', 'values.project', 'projects', 'fields.projects', 'values.projects'])(
    'suppresses both project representations under the resource alias %s', (alias) => {
      const row = { project_id: 'p-1', project_name: 'Visible', description: 'Private' };
      expect(projectRecord('project', row, [alias])).toBeNull();
      expect(projectRecordByRedactions([alias], row, PROJECT_RECORD_SOURCE)).toBeNull();
    },
  );

  it.each(['project.description', 'fields.project.description', 'projects.description', 'values.description'])(
    'redacts %s without suppressing the project or hiding unrelated fields', (alias) => {
      const row = { project_id: 'p-1', project_name: 'Visible', description: 'Private' };
      for (const projected of [
        projectRecord('project', row, [alias]),
        projectRecordByRedactions([alias], row, PROJECT_RECORD_SOURCE),
      ]) {
        expect(projected).toEqual({ project_id: 'p-1', project_name: 'Visible' });
      }
      expect(row.description).toBe('Private');
    },
  );
});
