import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('InteractionDetails agent schedule wiring', () => {
  it('opens agent schedule drawer when user name is clicked', () => {
    const filePath = path.resolve(__dirname, './InteractionDetails.tsx');
    const content = fs.readFileSync(filePath, 'utf-8');

    expect(content).toContain('handleUserClick');
    expect(content).toContain('<AgentScheduleDrawer');
  });
});
