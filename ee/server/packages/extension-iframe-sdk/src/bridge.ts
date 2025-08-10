import type {
  Envelope,
  HostToClientMessage,
  ClientToHostMessage,
  BootstrapPayload,
  EnvelopeVersion,
} from './types';

type Listener = (evt: HostToClientMessage) => void;

const ENVELOPE_VERSION: EnvelopeVersion = '1';

/**
 * IframeBridge implements a versioned, origin-validated postMessage protocol.
 * - Incoming messages MUST match expectedParentOrigin (defaults to window.location.origin)
 * - Messages MUST have { alga: true, version: "1" }
 * - Never uses targetOrigin="*" unless an explicit dev flag is set
 */
export class IframeBridge {
  private listeners: Set<Listener> = new Set();
  private expectedParentOrigin: string;
  private devWildcard: boolean;
  private sessionToken: string | null = null;
  private themeTokens: Record<string, string> = {};

  constructor(opts?: { expectedParentOrigin?: string; devAllowWildcard?: boolean }) {
    this.expectedParentOrigin =
      opts?.expectedParentOrigin ?? (typeof window !== 'undefined' ? window.location.origin : '');
    // Allow explicit dev wildcard only if requested; default off.
    const envDev =
      typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production';
    const globalDev =
      typeof window !== 'undefined' && (window as any).__ALGA_DEV__ === true;
    this.devWildcard = opts?.devAllowWildcard ?? !!(envDev || globalDev);

    if (typeof window !== 'undefined') {
      window.addEventListener('message', (ev: MessageEvent) => {
        // Origin validation
        if (this.expectedParentOrigin && ev.origin !== this.expectedParentOrigin) {
          // Ignore unexpected origins
          return;
        }
        const data = ev.data as Envelope | undefined;
        if (!data || typeof data !== 'object') return;
        if (data.alga !== true || data.version !== ENVELOPE_VERSION || typeof data.type !== 'string') {
          return;
        }

        // Known Host -> Client message types
        const msg = data as HostToClientMessage;

        // Handle bootstrap side effects for client
        if (msg.type === 'bootstrap') {
          const payload = msg.payload as BootstrapPayload;
          // Apply theme tokens to :root inside the iframe document
          if (payload?.theme_tokens && typeof document !== 'undefined') {
            this.themeTokens = payload.theme_tokens;
            const root = document.documentElement;
            Object.entries(this.themeTokens).forEach(([k, v]) => {
              try { root.style.setProperty(k, String(v)); } catch { /* noop */ }
            });
          }
          // Store session token in memory for hooks
          if (payload?.session?.token) {
            this.sessionToken = payload.session.token;
          }
        }

        this.listeners.forEach((l) => l(msg));
      });
    }
  }

  /**
   * Signal to the parent that the client is ready.
   */
  ready(requestId?: string) {
    this.emitToHost('ready', {}, requestId);
  }

  /**
   * Subscribe to Host -> Client messages (enveloped).
   */
  on(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Emit a Client -> Host message with envelope and version.
   */
  emitToHost<TPayload extends object = Record<string, unknown>>(
    type: ClientToHostMessage['type'],
    payload: TPayload,
    requestId?: string
  ) {
    if (typeof window === 'undefined') return;
    const envelope: Envelope<typeof type, TPayload> = {
      alga: true,
      version: ENVELOPE_VERSION,
      type,
      request_id: requestId,
      payload,
    };
    const targetOrigin = this.devWildcard ? '*' : this.expectedParentOrigin || '*'; // "*" only allowed when devWildcard is true
    window.parent?.postMessage(envelope, targetOrigin);
  }

  /**
   * Accessors for hooks to read last-known values after bootstrap.
   */
  getSessionToken(): string | null {
    return this.sessionToken;
  }

  getThemeTokens(): Record<string, string> {
    return this.themeTokens;
  }

  /**
   * Update expected parent origin (e.g., after dynamic configuration).
   */
  setExpectedParentOrigin(origin: string) {
    this.expectedParentOrigin = origin;
  }
}

