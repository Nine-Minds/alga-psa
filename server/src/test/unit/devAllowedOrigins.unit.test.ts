import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function getAllowedDevOrigins(env: Record<string, string | undefined>) {
  const serverDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../..',
  );
  const marker = 'ALLOWED_DEV_ORIGINS=';
  const stdout = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
        import nextConfig from './next.config.mjs';
        console.log(${JSON.stringify(marker)} + JSON.stringify(nextConfig.allowedDevOrigins));
      `,
    ],
    {
      cwd: serverDir,
      env: { ...process.env, ...env },
      encoding: 'utf8',
    },
  );
  const line = stdout
    .trim()
    .split('\n')
    .find((entry) => entry.startsWith(marker));
  if (!line) throw new Error(`Missing ${marker} in next.config.mjs output`);
  return JSON.parse(line.slice(marker.length)) as string[];
}

describe('Next.js development origins', () => {
  it('allows isolated IPv4 loopback and retains configured development origins', () => {
    expect(
      getAllowedDevOrigins({
        DEV_ALLOWED_ORIGINS: 'devbox.local, 192.168.1.20',
      }),
    ).toEqual(['127.0.0.1', 'devbox.local', '192.168.1.20']);
  });

  it('allows IPv4 loopback when no additional origins are configured', () => {
    expect(getAllowedDevOrigins({ DEV_ALLOWED_ORIGINS: '' })).toEqual([
      '127.0.0.1',
    ]);
  });
});
