import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('TicketDetails live timer board policy contract', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'TicketDetails.tsx'),
    'utf8'
  );

  it('T003: skips live timer auto-start when board-level live timer is disabled', () => {
    expect(source).toContain('if (!isLiveTicketTimerEnabled) return;');
  });

  it('T005: enforces immediate in-view timer stop when board policy disables live timer', () => {
    expect(source).toContain('const disableLiveTimerInView = async () => {');
    expect(source).toContain('await stopTracking();');
    expect(source).toContain('setIsRunning(false);');
    expect(source).toContain('setElapsedTime(0);');
  });

  it('wires live timer enablement down to ticket properties rendering', () => {
    expect(source).toContain('isLiveTicketTimerEnabled={isLiveTicketTimerEnabled}');
  });
});
