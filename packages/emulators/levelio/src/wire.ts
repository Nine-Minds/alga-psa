import express from 'express';
import type { NextFunction, Request, Response, Router } from 'express';
import { route } from '@alga-psa/emulator-host';
import type { HostEnv } from '@alga-psa/emulator-host';
import { LevelWireError } from './core';
import type { LevelEmulatorCore } from './core';
import { onAlertResolved, startRetryPump } from './dispatcher';

function query(req: Request): Record<string, unknown> {
  return req.query as Record<string, unknown>;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Level's v2 REST surface as Alga's LevelIoApiClient uses it: groups,
 * devices (with include_* detail flags), alerts (+ resolve) and updates, each
 * cursor-paginated. Point LEVELIO_API_BASE_URL at this origin.
 */
export function wire(router: Router, core: LevelEmulatorCore, _env: HostEnv): void {
  startRetryPump(core);
  router.use(express.json());

  const v2 = express.Router();
  router.use('/v2', v2);

  // Auth precedes everything, including the operation faults, as at Level's edge.
  v2.use((req, _res, next) => {
    try {
      core.authenticate(req.headers.authorization);
      next();
    } catch (error) {
      next(error);
    }
  });

  const operation = (name: string) => (_req: Request, _res: Response, next: NextFunction) => {
    const fault = core.consumeOperationFault(name);
    if (!fault) return next();
    const headers: Record<string, string> = {};
    if (fault.retryAfterSeconds !== null) headers['retry-after'] = String(fault.retryAfterSeconds);
    next(new LevelWireError(fault.status, fault.message, headers));
  };

  v2.get('/groups', operation('GET /v2/groups'), route((req, res) => {
    const parentId = query(req).parent_id;
    let groups = [...core.groups.values()];
    if (parentId === 'null') groups = groups.filter((g) => g.parent_id === null);
    else if (str(parentId)) groups = groups.filter((g) => g.parent_id === parentId);
    const page = core.paginate(groups, query(req));
    res.json({ data: page.data.map((g) => core.presentGroup(g)), has_more: page.has_more });
  }));

  v2.get('/groups/:id', operation('GET /v2/groups/:id'), route((req, res) => {
    res.json(core.presentGroup(core.getGroup(String(req.params.id))));
  }));

  v2.get('/devices', operation('GET /v2/devices'), route((req, res) => {
    const q = query(req);
    let devices = [...core.devices.values()];
    if (q.group_id === 'null') devices = devices.filter((d) => d.group_id === null);
    else if (str(q.group_id)) devices = devices.filter((d) => d.group_id === q.group_id);
    const ancestor = str(q.ancestor_group_id);
    if (ancestor) {
      const scope = core.descendantGroupIds(ancestor);
      devices = devices.filter((d) => d.group_id !== null && scope.has(d.group_id));
    }
    const tagId = str(q.tag_id);
    if (tagId) devices = devices.filter((d) => d.tags.some((tag) => core.tags.get(tag) === tagId));
    const hostname = str(q.hostname);
    if (hostname) devices = devices.filter((d) => d.hostname === hostname);
    const serial = str(q.serial_number);
    if (serial) devices = devices.filter((d) => d.serial_number === serial);
    const page = core.paginate(devices, q);
    res.json({ data: page.data.map((d) => core.presentDevice(d, q)), has_more: page.has_more });
  }));

  v2.get('/devices/:id', operation('GET /v2/devices/:id'), route((req, res) => {
    res.json(core.presentDevice(core.getDevice(String(req.params.id)), query(req)));
  }));

  v2.get('/alerts', operation('GET /v2/alerts'), route((req, res) => {
    const q = query(req);
    let alerts = [...core.alerts.values()];
    const deviceId = str(q.device_id);
    if (deviceId) alerts = alerts.filter((a) => a.device_id === deviceId);
    const status = str(q.status);
    if (status === 'active') alerts = alerts.filter((a) => !a.is_resolved);
    else if (status === 'resolved') alerts = alerts.filter((a) => a.is_resolved);
    else if (status) throw new LevelWireError(400, 'status must be one of: active, resolved');
    res.json(core.paginate(alerts, q));
  }));

  v2.get('/alerts/:id', operation('GET /v2/alerts/:id'), route((req, res) => {
    res.json(core.getAlert(String(req.params.id)));
  }));

  v2.post('/alerts/:id/resolve', operation('POST /v2/alerts/:id/resolve'), route(async (req, res) => {
    const { alert, changed } = core.resolveAlert(String(req.params.id));
    if (changed) await onAlertResolved(core, alert);
    res.json(alert);
  }));

  v2.get('/updates', operation('GET /v2/updates'), route((req, res) => {
    const q = query(req);
    let updates = [...core.updates.values()];
    const deviceId = str(q.device_id);
    if (deviceId) updates = updates.filter((u) => u.device_id === deviceId);
    const status = str(q.status);
    if (status === 'available') updates = updates.filter((u) => u.is_available);
    else if (status === 'installed') updates = updates.filter((u) => !u.is_available && u.installed_on !== null);
    else if (status) throw new LevelWireError(400, 'status must be one of: available, installed');
    const category = str(q.category);
    if (category) updates = updates.filter((u) => u.category === category);
    res.json(core.paginate(updates, q));
  }));

  v2.get('/updates/:id', operation('GET /v2/updates/:id'), route((req, res) => {
    res.json(core.getUpdate(String(req.params.id)));
  }));

  // Level documents more of v2 (group writes, tags, custom fields, automations,
  // activities); none of it is modeled. Say so instead of answering 404.
  v2.use(() => {
    throw new LevelWireError(501, 'This Level operation is not implemented by the emulator.', {}, 'EmulatorUnsupportedOperation');
  });

  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof LevelWireError) {
      for (const [name, value] of Object.entries(err.headers)) res.setHeader(name, value);
      res.status(err.status).json(err.toEnvelope());
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  });
}
