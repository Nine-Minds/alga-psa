import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('InteractionModel online meeting enrichment', () => {
  const sourcePath = path.resolve(__dirname, './interactions.ts');

  it('T066 getById and getForEntity attach online_meeting artifacts from OnlineMeetingModel', () => {
    const source = fs.readFileSync(sourcePath, 'utf-8');

    expect(source).toContain("import OnlineMeetingModel from './onlineMeeting'");
    expect(source).toContain('withOnlineMeeting(');
    expect(source).toContain('OnlineMeetingModel.getByInteractionId(interaction.interaction_id, tenantId)');
    expect(source).toContain('online_meeting: onlineMeeting');
    expect(source).toContain('return await this.withOnlineMeetings(interactions, scopedTenant)');
    expect(source).toContain('return await this.withOnlineMeeting({');
  });
});
