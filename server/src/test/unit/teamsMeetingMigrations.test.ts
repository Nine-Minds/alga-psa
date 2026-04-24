import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const appointmentRequestsMigration = require('../../../../server/migrations/20260423130000_add_online_meeting_columns_to_appointment_requests.cjs');
const teamsIntegrationsMigration = require('../../../../ee/server/migrations/20260423131000_add_default_meeting_organizer_to_teams_integrations.cjs');

function buildKnexForAddedColumns(columnPresence: Record<string, boolean>) {
  const addedColumns: Array<{
    table: string;
    column: string;
    type: string;
    nullable: boolean;
  }> = [];

  const knex = {
    schema: {
      hasColumn: vi.fn(async (_table: string, column: string) => Boolean(columnPresence[column])),
      alterTable: vi.fn(async (tableName: string, callback: (table: any) => void) => {
        const table = {
          text: (columnName: string) => ({
            nullable: () => {
              addedColumns.push({
                table: tableName,
                column: columnName,
                type: 'text',
                nullable: true,
              });
            },
          }),
          dropColumn: vi.fn(),
        };

        callback(table);
      }),
    },
  };

  return { knex, addedColumns };
}

describe('Teams meeting migrations', () => {
  it('adds the online_meeting_* text columns to appointment_requests as nullable fields', async () => {
    const { knex, addedColumns } = buildKnexForAddedColumns({
      online_meeting_provider: false,
      online_meeting_url: false,
      online_meeting_id: false,
    });

    await appointmentRequestsMigration.up(knex);

    expect(addedColumns).toEqual([
      {
        table: 'appointment_requests',
        column: 'online_meeting_provider',
        type: 'text',
        nullable: true,
      },
      {
        table: 'appointment_requests',
        column: 'online_meeting_url',
        type: 'text',
        nullable: true,
      },
      {
        table: 'appointment_requests',
        column: 'online_meeting_id',
        type: 'text',
        nullable: true,
      },
    ]);
  });

  it('adds default_meeting_organizer_upn to teams_integrations as a nullable text column', async () => {
    const { knex, addedColumns } = buildKnexForAddedColumns({
      default_meeting_organizer_upn: false,
    });

    await teamsIntegrationsMigration.up(knex);

    expect(addedColumns).toEqual([
      {
        table: 'teams_integrations',
        column: 'default_meeting_organizer_upn',
        type: 'text',
        nullable: true,
      },
    ]);
  });
});
