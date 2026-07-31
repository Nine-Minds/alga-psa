import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEAMS_DELIVERY_ERROR_CODES, TEAMS_DELIVERY_ERROR_REMEDIES } from './teamsTroubleshooting';

const REPO_ROOT = path.resolve(__dirname, '../../../../../../..');
const RECORDER = path.join(REPO_ROOT, 'ee/packages/microsoft-teams/src/lib/notifications/teamsDeliveryRecorder.ts');

function parseErrorCodeUnion(): string[] {
  const src = fs.readFileSync(RECORDER, 'utf8');
  const match = src.match(/export type TeamsDeliveryErrorCode =([\s\S]*?);/);
  if (!match) {
    throw new Error('Could not find TeamsDeliveryErrorCode union in the EE delivery recorder');
  }
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('Teams troubleshooting remedy map (F062 / T100)', () => {
  it('T100: covers exactly the EE delivery error-code union', () => {
    const union = parseErrorCodeUnion();
    expect(union.length).toBeGreaterThan(0);
    expect(new Set(TEAMS_DELIVERY_ERROR_CODES)).toEqual(new Set(union));
  });

  it('T100: every delivery error code has a cause + remedy entry', () => {
    for (const code of TEAMS_DELIVERY_ERROR_CODES) {
      const remedy = TEAMS_DELIVERY_ERROR_REMEDIES[code];
      expect(remedy, `remedy for ${code}`).toBeTruthy();
      expect(remedy.causeDefault.trim().length, `cause text for ${code}`).toBeGreaterThan(0);
      expect(remedy.remedyDefault.trim().length, `remedy text for ${code}`).toBeGreaterThan(0);
      expect(remedy.causeKey).toBe(`integrations.teams.settings.troubleshooting.codes.${code}.cause`);
      expect(remedy.remedyKey).toBe(`integrations.teams.settings.troubleshooting.codes.${code}.remedy`);
    }
    // No stray codes without a listed code.
    expect(Object.keys(TEAMS_DELIVERY_ERROR_REMEDIES).sort()).toEqual([...TEAMS_DELIVERY_ERROR_CODES].sort());
  });
});
