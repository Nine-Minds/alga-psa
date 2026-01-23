import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

type Edition = 'ce' | 'ee';

function getWebpackAliases(edition: Edition) {
  const script = `
    import path from 'node:path';
    import { pathToFileURL } from 'node:url';

    const configPath = path.resolve(process.cwd(), 'server/next.config.mjs');
    const nextConfig = (await import(pathToFileURL(configPath).href)).default;

    const base = {
      resolve: { alias: {} },
      plugins: [],
      module: { rules: [] },
      output: { path: path.resolve(process.cwd(), 'server/.next') },
    };

    const webpackConfig = nextConfig.webpack(base, { isServer: true });
    const alias = webpackConfig.resolve.alias;

    console.log(JSON.stringify({
      ee: alias['@ee'],
      eeServerSrc: alias['ee/server/src'],
      emailProvidersEntry: alias['@alga-psa/integrations/email/providers/entry'],
      emailSettingsEntry: alias['@alga-psa/integrations/email/settings/entry'],
      clientPortalDomainSettingsEntry: alias['@alga-psa/client-portal/domain-settings/entry'],
    }));
  `;

  const env =
    edition === 'ee'
      ? { ...process.env, EDITION: 'ee', NEXT_PUBLIC_EDITION: 'enterprise' }
      : (() => {
          const nextEnv = { ...process.env };
          delete nextEnv.EDITION;
          delete nextEnv.NEXT_PUBLIC_EDITION;
          return nextEnv;
        })();

  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const start = output.lastIndexOf('{');
  const end = output.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Expected JSON object in output. Output:\n${output}`);
  }
  const json = output.slice(start, end + 1);

  return JSON.parse(json) as {
    ee: string;
    eeServerSrc: string;
    emailProvidersEntry: string;
    emailSettingsEntry: string;
    clientPortalDomainSettingsEntry: string;
  };
}

describe('CE/EE build swapping', () => {
  it('CE build excludes EE code in module resolution', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const alias = getWebpackAliases('ce');

      expect(alias.ee).toBe(path.resolve(process.cwd(), 'server/src/empty'));
      expect(alias.eeServerSrc).toBe(path.resolve(process.cwd(), 'server/src/empty'));

      expect(alias.emailProvidersEntry).toBe(
        path.resolve(process.cwd(), 'packages/integrations/src/email/providers/oss/entry.tsx')
      );
      expect(alias.emailSettingsEntry).toBe(
        path.resolve(process.cwd(), 'packages/integrations/src/email/settings/oss/entry.tsx')
      );
      expect(alias.clientPortalDomainSettingsEntry).toBe(
        path.resolve(process.cwd(), 'packages/client-portal/src/domain-settings/oss/entry.tsx')
      );
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('EE build includes EE code in module resolution', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const alias = getWebpackAliases('ee');

      expect(alias.ee).toBe(path.resolve(process.cwd(), 'ee/server/src'));
      expect(alias.eeServerSrc).toBe(path.resolve(process.cwd(), 'ee/server/src'));

      expect(alias.emailProvidersEntry).toBe(
        path.resolve(process.cwd(), 'packages/integrations/src/email/providers/ee/entry.tsx')
      );
      expect(alias.emailSettingsEntry).toBe(
        path.resolve(process.cwd(), 'packages/integrations/src/email/settings/ee/entry.tsx')
      );
      expect(alias.clientPortalDomainSettingsEntry).toBe(
        path.resolve(process.cwd(), 'packages/client-portal/src/domain-settings/ee/entry.tsx')
      );
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
