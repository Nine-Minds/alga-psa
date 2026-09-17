import http from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import type { EmulatorServer, HostEnv } from '@alga-psa/emulator-host';
import { TOKEN_TTL_SECONDS, type PbxApp, type ThreecxEmulatorCore } from './core';
import { applyQuery, ODataError } from './odata';

export const CALL_CONTROL_WS_PATH = '/callcontrol/ws';

declare module 'express-serve-static-core' {
  interface Request {
    pbxApp?: PbxApp;
  }
}

function bearer(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function odata(res: Response, rows: object[], query: Record<string, unknown>): void {
  try {
    res.json({ value: applyQuery(rows, query) });
  } catch (error) {
    if (error instanceof ODataError) res.status(400).json({ error: { message: error.message } });
    else throw error;
  }
}

function intParam(raw: string | undefined): number {
  return Number(raw);
}

function makeCallResult(participant: ReturnType<ThreecxEmulatorCore['makeCall']>) {
  return { finalstatus: 'Success', reason: '', result: participant };
}

/**
 * The PBX surface: `/connect/token`, XAPI (OData) and call control on one
 * port, with the call-control event feed on a WebSocket at /callcontrol/ws.
 */
export async function serve(core: ThreecxEmulatorCore, port: number, _env: HostEnv): Promise<EmulatorServer> {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false }));

  app.get('/', (_req, res) => {
    res.json({ ok: true, emulator: 'threecx', exchanges: core.exchanges.length });
  });

  app.post('/connect/token', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const grant = String(body.grant_type ?? 'client_credentials');
    const token = grant === 'client_credentials'
      ? core.issueToken(String(body.client_id ?? ''), String(body.client_secret ?? ''))
      : null;
    if (!token) {
      res.status(401).json({ error: 'invalid_client' });
      return;
    }
    res.json({ access_token: token.token, expires_in: TOKEN_TTL_SECONDS, token_type: 'Bearer' });
  });

  // Every route below carries a bearer issued above; capability gates mirror the app's permissions.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const pbxApp = core.appForToken(bearer(req.headers.authorization));
    if (!pbxApp) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const denied = (req.path.startsWith('/xapi/') && !pbxApp.xapi) || (req.path.startsWith('/callcontrol') && !pbxApp.callControl);
    if (denied) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    req.pbxApp = pbxApp;
    next();
  });

  // ---- XAPI ----
  app.get('/xapi/v1/Defs', (_req, res) => {
    res.json({ value: [{ Id: 1 }] });
  });

  app.get('/xapi/v1/Users', (req, res) => {
    odata(res, [...core.users.values()], req.query as Record<string, unknown>);
  });

  app.get('/xapi/v1/Contacts', (req, res) => {
    odata(res, [...core.contacts.values()], req.query as Record<string, unknown>);
  });

  app.post('/xapi/v1/Contacts', (req, res) => {
    res.status(201).json(core.createContact(req.body ?? {}));
  });

  app.post('/xapi/v1/Contacts/Pbx.DeleteContactsById', (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
    for (const id of ids) core.contacts.delete(id);
    res.status(204).end();
  });

  const contactById = /^\/xapi\/v1\/Contacts\((\d+)\)$/;
  app.get(contactById, (req, res) => {
    const contact = core.contacts.get(intParam(req.params[0]));
    if (!contact) res.status(404).json({ error: 'not found' });
    else res.json(contact);
  });
  app.patch(contactById, (req, res) => {
    const contact = core.patchContact(intParam(req.params[0]), req.body ?? {});
    if (!contact) res.status(404).json({ error: 'not found' });
    else res.json(contact);
  });
  app.delete(contactById, (req, res) => {
    if (!core.contacts.delete(intParam(req.params[0]))) res.status(404).json({ error: 'not found' });
    else res.status(204).end();
  });

  app.get('/xapi/v1/CallHistoryView', (req, res) => {
    odata(res, [...core.cdrSegments.values()], req.query as Record<string, unknown>);
  });

  app.get('/xapi/v1/Recordings', (req, res) => {
    odata(res, [...core.recordings.values()], req.query as Record<string, unknown>);
  });

  app.get(/^\/xapi\/v1\/Recordings\/Pbx\.DownloadRecording\(recId=(\d+)\)$/, (req, res) => {
    const bytes = core.recordingBytesFor(intParam(req.params[0]));
    if (!bytes) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.status(200).type('audio/wav').send(bytes);
  });

  app.post('/xapi/v1/Users/Pbx.MakeCall', (req, res) => {
    const { dn, destination } = (req.body ?? {}) as { dn?: string; destination?: string };
    if (!dn || !destination) {
      res.status(400).json({ error: 'dn and destination are required' });
      return;
    }
    res.json(makeCallResult(core.makeCall(String(dn), String(destination), 'xapi')));
  });

  // ---- Call control ----
  app.get('/callcontrol', (_req, res) => {
    res.json([...core.users.values()].map((user) => ({ dn: user.Number, type: 'Wextension' })));
  });

  app.post('/callcontrol/:dn/makecall', (req, res) => {
    const { destination } = (req.body ?? {}) as { destination?: string };
    if (!destination) {
      res.status(400).json({ error: 'destination is required' });
      return;
    }
    res.json(makeCallResult(core.makeCall(String(req.params.dn), String(destination), 'callcontrol')));
  });

  app.get('/callcontrol/:dn/participants/:id', (req, res) => {
    const participant = core.participants.get(intParam(req.params.id));
    if (!participant || participant.dn !== req.params.dn) res.status(404).json({ error: 'not found' });
    else res.json(participant);
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const reject = (status: number, text: string) => {
      socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (pathname !== CALL_CONTROL_WS_PATH) return reject(404, 'Not Found');
    const pbxApp = core.appForToken(bearer(req.headers.authorization));
    if (!pbxApp) return reject(401, 'Unauthorized');
    if (!pbxApp.callControl) return reject(403, 'Forbidden');
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    const untrack = core.trackConnection(() => ws.close(1012, 'ws-drop'));
    ws.on('close', untrack);
  });

  const unsubscribe = core.onEvent((event) => {
    const payload = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolve());
  });
  const address = server.address();
  const boundPort = address && typeof address === 'object' ? address.port : port;

  return {
    port: boundPort,
    close: () =>
      new Promise<void>((resolve, reject) => {
        unsubscribe();
        for (const client of wss.clients) client.terminate();
        wss.close();
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
