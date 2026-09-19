import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Hocuspocus URL selection must be driven by NODE_ENV, never by sniffing the
 * browser hostname. A dev server reached over a LAN/tailnet address previously
 * derived a same-origin ws://<tailnet-host>/hocuspocus URL and failed to reach
 * the local Hocuspocus instance; production must keep deriving same-origin.
 *
 * The three selectors are duplicated by package boundary (server hook,
 * notifications package hook, editor yjs config), so each is asserted against
 * the same matrix.
 */

type UrlSelector = () => string | null;

const TAILNET_HOST = '100.64.0.5:3415';

async function loadSelectors(): Promise<Record<string, UrlSelector>> {
  const ui = await import('@alga-psa/ui/editor/yjs-config');
  const notifications = await import(
    '@alga-psa/notifications/hooks/useInternalNotifications'
  );
  const server = await import('@/hooks/useInternalNotifications');
  return {
    'server hook': server.getHocuspocusUrl as UrlSelector,
    'notifications package hook': notifications.getHocuspocusUrl as UrlSelector,
    'editor yjs config': ui.getHocuspocusUrl as UrlSelector,
  };
}

describe('Hocuspocus URL selection', () => {
  let selectors: Record<string, UrlSelector>;

  beforeAll(async () => {
    selectors = await loadSelectors();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    delete process.env.NEXT_PUBLIC_HOCUSPOCUS_URL;
    delete process.env.HOCUSPOCUS_INTERNAL_URL;
  });

  function stubBrowser(protocol: string, host: string) {
    vi.stubGlobal('window', { location: { protocol, host } });
  }

  describe.each([
    'server hook',
    'notifications package hook',
    'editor yjs config',
  ])('%s', (name) => {
    it('development honors the configured URL on a tailnet hostname', () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('NEXT_PUBLIC_HOCUSPOCUS_URL', 'ws://127.0.0.1:1234');
      stubBrowser('http:', TAILNET_HOST);

      expect(selectors[name]()).toBe('ws://127.0.0.1:1234');
    });

    it('development falls back to ws://localhost:1234 on a tailnet hostname', () => {
      vi.stubEnv('NODE_ENV', 'development');
      stubBrowser('http:', TAILNET_HOST);

      expect(selectors[name]()).toBe('ws://localhost:1234');
    });

    it('production honors an explicit URL override', () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('NEXT_PUBLIC_HOCUSPOCUS_URL', 'wss://collab.example.com/hocuspocus');
      stubBrowser('https:', 'app.example.com');

      expect(selectors[name]()).toBe('wss://collab.example.com/hocuspocus');
    });

    it('production derives the same-origin /hocuspocus URL over ws', () => {
      vi.stubEnv('NODE_ENV', 'production');
      stubBrowser('http:', TAILNET_HOST);

      expect(selectors[name]()).toBe(`ws://${TAILNET_HOST}/hocuspocus`);
    });

    it('production derives the same-origin /hocuspocus URL over wss', () => {
      vi.stubEnv('NODE_ENV', 'production');
      stubBrowser('https:', 'app.example.com');

      expect(selectors[name]()).toBe('wss://app.example.com/hocuspocus');
    });
  });
});
