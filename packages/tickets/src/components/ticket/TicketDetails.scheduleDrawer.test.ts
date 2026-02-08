import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('TicketDetails agent schedule wiring', () => {
  it('opens agent schedule drawer when agent name is clicked', () => {
    const filePath = path.resolve(__dirname, './TicketDetails.tsx');
    const content = fs.readFileSync(filePath, 'utf-8');

    expect(content).toContain('handleAgentClick');
    expect(content).toContain('<AgentScheduleDrawer');
  });
});
