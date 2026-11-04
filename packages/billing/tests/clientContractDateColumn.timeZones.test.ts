import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(__dirname, '..');
const vitestBin = path.resolve(packageRoot, '../../node_modules/.bin/vitest');

// East of UTC (where the toISOString read went a day back), UTC itself, and west of UTC.
const ZONES = ['Pacific/Auckland', 'Europe/Berlin', 'Asia/Tokyo', 'UTC', 'America/New_York', 'America/Los_Angeles'];

describe('client_contracts DATE normalization under real server time zones', () => {
  it.each(ZONES)('emits 2026-04-01 for a local-midnight pg Date in %s', (zone) => {
    const result = spawnSync(
      vitestBin,
      ['run', '--config', 'vitest.config.ts', 'tests/clientContractDateColumn.test.ts'],
      {
        cwd: packageRoot,
        env: { ...process.env, TZ: zone, EXPECT_TZ: zone, CI: '1' },
        encoding: 'utf8',
      }
    );

    expect(`${result.stdout}\n${result.stderr}`).toContain('1 passed');
    expect(result.status).toBe(0);
  }, 120_000);
});
