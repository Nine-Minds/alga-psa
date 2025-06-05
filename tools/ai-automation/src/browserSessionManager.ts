import puppeteer from 'puppeteer';
import type { Browser, Page } from 'puppeteer';

interface BrowserSessionState {
  url: string;
  cookies: any[];
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  viewport: { width: number; height: number };
  userAgent: string;
}

interface BrowserSession {
  id: string;
  browser: Browser;
  page: Page;
  mode: 'headless' | 'headed';
  state: BrowserSessionState;
  wsEndpoint?: string;
}

export class BrowserSessionManager {
  private static instance: BrowserSessionManager;
  private sessions: Map<string, BrowserSession> = new Map();
  private activeSessionId: string | null = null;

  private constructor() {}

  public static getInstance(): BrowserSessionManager {
    if (!BrowserSessionManager.instance) {
      BrowserSessionManager.instance = new BrowserSessionManager();
    }
    return BrowserSessionManager.instance;
  }

  /**
   * Create a new browser session
   */
  public async createSession(sessionId: string, mode: 'headless' | 'headed' = 'headless'): Promise<BrowserSession> {
    console.log(`[SESSION] Creating new ${mode} browser session: ${sessionId}`);

    const launchOptions: any = {
      headless: mode === 'headless' ? 'new' : false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1900,1200',
        ...(mode === 'headed' ? [
          '--start-maximized',
          '--remote-debugging-port=9222',
          '--remote-debugging-address=0.0.0.0'
        ] : [])
      ],
      protocolTimeout: 60000,
      dumpio: true, // Enable for debugging
      slowMo: mode === 'headed' ? 50 : 100
    };

    // For container environment, always use virtual display
    if (process.env.DISPLAY) {
      launchOptions.env = {
        ...process.env,
        DISPLAY: process.env.DISPLAY
      };
    }

    const browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    await page.setViewport({ width: 1900, height: 1200 });

    // Setup page event listeners
    page.on('console', (msg) => {
      console.log(`[SESSION ${sessionId}] [PAGE CONSOLE] ${msg.type()}: ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      console.error(`[SESSION ${sessionId}] [PAGE ERROR]`, err);
    });

    const session: BrowserSession = {
      id: sessionId,
      browser,
      page,
      mode,
      state: await this.captureSessionState(page),
      wsEndpoint: browser.wsEndpoint()
    };

    this.sessions.set(sessionId, session);
    this.activeSessionId = sessionId;

    console.log(`[SESSION] Session ${sessionId} created successfully in ${mode} mode`);
    return session;
  }

  /**
   * Capture current browser state for later restoration
   */
  private async captureSessionState(page: Page): Promise<BrowserSessionState> {
    try {
      const [url, cookies, localStorage, sessionStorage, viewport, userAgent] = await Promise.all([
        page.url(),
        page.cookies(),
        page.evaluate(() => {
          const storage: Record<string, string> = {};
          for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i);
            if (key) storage[key] = window.localStorage.getItem(key) || '';
          }
          return storage;
        }),
        page.evaluate(() => {
          const storage: Record<string, string> = {};
          for (let i = 0; i < window.sessionStorage.length; i++) {
            const key = window.sessionStorage.key(i);
            if (key) storage[key] = window.sessionStorage.getItem(key) || '';
          }
          return storage;
        }),
        page.viewport(),
        page.evaluate(() => navigator.userAgent)
      ]);

      return {
        url,
        cookies,
        localStorage,
        sessionStorage,
        viewport: viewport || { width: 1900, height: 1200 },
        userAgent
      };
    } catch (error) {
      console.error('[SESSION] Error capturing session state:', error);
      return {
        url: 'about:blank',
        cookies: [],
        localStorage: {},
        sessionStorage: {},
        viewport: { width: 1900, height: 1200 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      };
    }
  }

  /**
   * Restore browser state from captured session state
   */
  private async restoreSessionState(page: Page, state: BrowserSessionState): Promise<void> {
    try {
      console.log('[SESSION] Restoring session state...');

      // Set viewport
      await page.setViewport(state.viewport);

      // Set user agent
      await page.setUserAgent(state.userAgent);

      // Set cookies (must be done before navigation)
      if (state.cookies.length > 0) {
        await page.setCookie(...state.cookies);
      }

      // Navigate to the saved URL
      if (state.url && state.url !== 'about:blank') {
        await page.goto(state.url, { waitUntil: 'networkidle2', timeout: 30000 });
      }

      // Restore localStorage and sessionStorage
      await page.evaluate((localStorage, sessionStorage) => {
        // Clear existing storage
        window.localStorage.clear();
        window.sessionStorage.clear();

        // Restore localStorage
        Object.entries(localStorage).forEach(([key, value]) => {
          window.localStorage.setItem(key, value);
        });

        // Restore sessionStorage
        Object.entries(sessionStorage).forEach(([key, value]) => {
          window.sessionStorage.setItem(key, value);
        });
      }, state.localStorage, state.sessionStorage);

      console.log('[SESSION] Session state restored successfully');
    } catch (error) {
      console.error('[SESSION] Error restoring session state:', error);
    }
  }

  /**
   * Pop out the current session to headed mode
   */
  public async popOutSession(sessionId?: string): Promise<BrowserSession> {
    const targetSessionId = sessionId || this.activeSessionId;
    if (!targetSessionId) {
      throw new Error('No active session to pop out');
    }

    const currentSession = this.sessions.get(targetSessionId);
    if (!currentSession) {
      throw new Error(`Session ${targetSessionId} not found`);
    }

    if (currentSession.mode === 'headed') {
      console.log(`[SESSION] Session ${targetSessionId} is already in headed mode`);
      return currentSession;
    }

    console.log(`[SESSION] Popping out session ${targetSessionId} to headed mode`);

    // Capture current state
    const currentState = await this.captureSessionState(currentSession.page);

    // Create new headed session
    const poppedSessionId = `${targetSessionId}-headed`;
    const headedSession = await this.createSession(poppedSessionId, 'headed');

    // Restore state in the new headed browser
    await this.restoreSessionState(headedSession.page, currentState);

    // Close the old headless session
    await this.closeSession(targetSessionId);

    // Update active session
    this.activeSessionId = poppedSessionId;

    console.log(`[SESSION] Successfully popped out to session ${poppedSessionId}`);
    return headedSession;
  }

  /**
   * Pop in a headed session back to headless mode
   */
  public async popInSession(sessionId?: string): Promise<BrowserSession> {
    const targetSessionId = sessionId || this.activeSessionId;
    if (!targetSessionId) {
      throw new Error('No active session to pop in');
    }

    const currentSession = this.sessions.get(targetSessionId);
    if (!currentSession) {
      throw new Error(`Session ${targetSessionId} not found`);
    }

    if (currentSession.mode === 'headless') {
      console.log(`[SESSION] Session ${targetSessionId} is already in headless mode`);
      return currentSession;
    }

    console.log(`[SESSION] Popping in session ${targetSessionId} to headless mode`);

    // Capture current state
    const currentState = await this.captureSessionState(currentSession.page);

    // Create new headless session
    const headlessSessionId = targetSessionId.replace('-headed', '') || `${targetSessionId}-headless`;
    const headlessSession = await this.createSession(headlessSessionId, 'headless');

    // Restore state in the new headless browser
    await this.restoreSessionState(headlessSession.page, currentState);

    // Close the old headed session
    await this.closeSession(targetSessionId);

    // Update active session
    this.activeSessionId = headlessSessionId;

    console.log(`[SESSION] Successfully popped in to session ${headlessSessionId}`);
    return headlessSession;
  }

  /**
   * Connect to an existing browser via WebSocket endpoint
   */
  public async connectToExistingBrowser(sessionId: string, wsEndpoint: string): Promise<BrowserSession> {
    console.log(`[SESSION] Connecting to existing browser: ${wsEndpoint}`);

    try {
      const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
      const pages = await browser.pages();
      const page = pages[0] || await browser.newPage();

      const session: BrowserSession = {
        id: sessionId,
        browser,
        page,
        mode: 'headed', // Assume existing browsers are headed
        state: await this.captureSessionState(page),
        wsEndpoint
      };

      this.sessions.set(sessionId, session);
      this.activeSessionId = sessionId;

      console.log(`[SESSION] Successfully connected to existing browser as session ${sessionId}`);
      return session;
    } catch (error) {
      console.error('[SESSION] Failed to connect to existing browser:', error);
      throw error;
    }
  }

  /**
   * Get the active session
   */
  public getActiveSession(): BrowserSession | null {
    if (!this.activeSessionId) return null;
    return this.sessions.get(this.activeSessionId) || null;
  }

  /**
   * Get session by ID
   */
  public getSession(sessionId: string): BrowserSession | null {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * List all sessions
   */
  public listSessions(): Array<{ id: string; mode: 'headless' | 'headed'; url: string; wsEndpoint?: string }> {
    return Array.from(this.sessions.values()).map(session => ({
      id: session.id,
      mode: session.mode,
      url: session.state.url,
      wsEndpoint: session.wsEndpoint
    }));
  }

  /**
   * Close a specific session
   */
  public async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.log(`[SESSION] Session ${sessionId} not found, nothing to close`);
      return;
    }

    console.log(`[SESSION] Closing session ${sessionId}`);
    try {
      await session.browser.close();
    } catch (error) {
      console.error(`[SESSION] Error closing session ${sessionId}:`, error);
    }

    this.sessions.delete(sessionId);

    if (this.activeSessionId === sessionId) {
      // Set active session to another session if available
      const remainingSessions = Array.from(this.sessions.keys());
      this.activeSessionId = remainingSessions.length > 0 ? remainingSessions[0] : null;
    }

    console.log(`[SESSION] Session ${sessionId} closed`);
  }

  /**
   * Close all sessions
   */
  public async closeAllSessions(): Promise<void> {
    console.log('[SESSION] Closing all sessions');
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(sessionIds.map(id => this.closeSession(id)));
    this.activeSessionId = null;
    console.log('[SESSION] All sessions closed');
  }

  /**
   * Get browser session status
   */
  public getSessionStatus(): {
    activeSessionId: string | null;
    sessionCount: number;
    sessions: Array<{ id: string; mode: 'headless' | 'headed'; url: string; wsEndpoint?: string }>;
  } {
    return {
      activeSessionId: this.activeSessionId,
      sessionCount: this.sessions.size,
      sessions: this.listSessions()
    };
  }
}

export const browserSessionManager = BrowserSessionManager.getInstance();