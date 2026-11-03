import { describe, expect, it } from 'vitest';
import { assertProjectFieldsWritable, authorizeAndProjectProjectRecords } from './projectReadProjection';

const rows = [
  {
    project_id: 'p1',
    project_name: 'Visible project',
    description: 'confidential description',
    client_id: 'c1',
    client_name: 'Confidential client',
    assigned_to: 'u1',
    assigned_to_first_name: 'Hidden',
    assigned_to_last_name: 'Manager',
    assigned_user: { first_name: 'Hidden', last_name: 'Manager' },
    contact_name_id: 'contact1',
    contact_name: 'Hidden contact',
    status: 'status1',
    status_name: 'Hidden status',
    is_closed: true,
  },
  { project_id: 'p2', project_name: 'Denied project', description: 'not returned' },
];

describe('project read projection', () => {
  it('projects allowed-but-redacted list and detail records and removes derived values', async () => {
    const authorize = async (row: (typeof rows)[number]) => ({
      allowed: row.project_id === 'p1',
      redactedFields: ['projects.description', 'client_name', 'assigned_to_first_name', 'contact_name', 'status_name'],
    });

    const list = await authorizeAndProjectProjectRecords(rows, authorize);
    const detail = await authorizeAndProjectProjectRecords([rows[0]], authorize);

    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty('description');
    expect(list[0]).not.toHaveProperty('client_id');
    expect(list[0]).not.toHaveProperty('client_name');
    expect(list[0]).not.toHaveProperty('assigned_to');
    expect(list[0]).not.toHaveProperty('assigned_to_first_name');
    expect(list[0]).not.toHaveProperty('assigned_to_last_name');
    expect(list[0]).not.toHaveProperty('assigned_user');
    expect(list[0]).not.toHaveProperty('contact_name');
    expect(list[0]).not.toHaveProperty('status_name');
    expect(list[0]).not.toHaveProperty('is_closed');
    expect(detail[0]).toEqual(list[0]);
    expect(detail[0]).toHaveProperty('project_name', 'Visible project');
  });

  it('rejects a write to a field hidden by the effective update decision', () => {
    expect(() => assertProjectFieldsWritable(['description'], ['description'])).toThrow(/redacted project field/);
    expect(() => assertProjectFieldsWritable(['description'], ['project_name'])).not.toThrow();
    expect(() => assertProjectFieldsWritable(['*'], ['project_name'])).toThrow(/redacted project field/);
  });
});
