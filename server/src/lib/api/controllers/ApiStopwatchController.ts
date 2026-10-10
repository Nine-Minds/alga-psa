/**
 * API Stopwatch Controller
 * REST endpoints for the server-side stopwatch (/api/v1/stopwatch). Authentication, RBAC and body
 * validation live here; everything else is StopwatchApiService -> stopwatchCore.
 *
 * RBAC: time_entry:read for GET /active, time_entry:create for every mutation. Mutations always act
 * on the caller's own session; GET /active?user_id= reads another user's session only when
 * assertCanActOnBehalf allows it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { ZodError, type ZodSchema } from 'zod';
import { ApiBaseController } from './ApiBaseController';
import { StopwatchApiService } from '../services/StopwatchApiService';
import {
  activeStopwatchQuerySchema,
  logStopwatchSchema,
  startStopwatchSchema,
  updateStopwatchSchema,
} from '../schemas/stopwatch';
import {
  AuthenticatedApiRequest,
  ValidationError,
  createSuccessResponse,
  handleApiError,
} from '../middleware/apiMiddleware';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ApiStopwatchController extends ApiBaseController {
  private stopwatchService: StopwatchApiService;

  constructor() {
    const stopwatchService = new StopwatchApiService();
    super(stopwatchService as any, {
      resource: 'stopwatch',
      permissionResource: 'time_entry',
    });
    this.stopwatchService = stopwatchService;
  }

  /** Session id from `/api/v1/stopwatch/{id}[/action]`. */
  private sessionIdFromPath(req: AuthenticatedApiRequest): string {
    const parts = new URL(req.url).pathname.split('/').filter(Boolean);
    const index = parts.lastIndexOf('stopwatch');
    const id = index >= 0 ? parts[index + 1] : undefined;
    if (!id || !UUID_REGEX.test(id)) {
      throw new ValidationError('Invalid stopwatch session ID format');
    }
    return id;
  }

  private async parseBody<T>(req: AuthenticatedApiRequest, schema: ZodSchema<T>, allowEmpty = false): Promise<T> {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      if (!allowEmpty) throw new ValidationError('Request body must be valid JSON');
      body = {};
    }
    try {
      return schema.parse(body ?? {});
    } catch (error) {
      if (error instanceof ZodError) throw new ValidationError('Validation failed', error.errors);
      throw error;
    }
  }

  private run(
    action: 'read' | 'create',
    handler: (apiRequest: AuthenticatedApiRequest) => Promise<NextResponse>,
  ) {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await this.runWithApiKeyContext(apiRequest, async () => {
          await this.checkPermission(apiRequest, action);
          return handler(apiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /** GET /api/v1/stopwatch/active - the open session, or null. */
  getActive() {
    return this.run('read', async (apiRequest) => {
      const query = this.validateQuery(apiRequest, activeStopwatchQuerySchema) as { user_id?: string };
      const session = await this.stopwatchService.getActive(apiRequest.context, query.user_id);
      return createSuccessResponse(session, 200, undefined, apiRequest);
    });
  }

  /** POST /api/v1/stopwatch - start. 201 session; 409 with details.open_session. */
  start() {
    return this.run('create', async (apiRequest) => {
      const data = await this.parseBody(apiRequest, startStopwatchSchema);
      const session = await this.stopwatchService.start(data, apiRequest.context);
      return createSuccessResponse(session, 201, undefined, apiRequest);
    });
  }

  /** POST /api/v1/stopwatch/{id}/pause */
  pause() {
    return this.run('create', async (apiRequest) => {
      const session = await this.stopwatchService.pause(this.sessionIdFromPath(apiRequest), apiRequest.context);
      return createSuccessResponse(session, 200, undefined, apiRequest);
    });
  }

  /** POST /api/v1/stopwatch/{id}/resume */
  resume() {
    return this.run('create', async (apiRequest) => {
      const session = await this.stopwatchService.resume(this.sessionIdFromPath(apiRequest), apiRequest.context);
      return createSuccessResponse(session, 200, undefined, apiRequest);
    });
  }

  /** PATCH /api/v1/stopwatch/{id} - update notes / service of the open session. */
  updateDraft() {
    return this.run('create', async (apiRequest) => {
      const id = this.sessionIdFromPath(apiRequest);
      const data = await this.parseBody(apiRequest, updateStopwatchSchema);
      const session = await this.stopwatchService.updateDraft(id, data, apiRequest.context);
      return createSuccessResponse(session, 200, undefined, apiRequest);
    });
  }

  /** POST /api/v1/stopwatch/{id}/log - 201 { session, time_entry }. Locked sheet -> 409. */
  log() {
    return this.run('create', async (apiRequest) => {
      const id = this.sessionIdFromPath(apiRequest);
      const data = await this.parseBody(apiRequest, logStopwatchSchema, true);
      const result = await this.stopwatchService.log(id, data, apiRequest.context);
      return createSuccessResponse(result, 201, undefined, apiRequest);
    });
  }

  /** DELETE /api/v1/stopwatch/{id} - discard. 204. */
  discard() {
    return this.run('create', async (apiRequest) => {
      await this.stopwatchService.discard(this.sessionIdFromPath(apiRequest), apiRequest.context);
      return createSuccessResponse(null, 204);
    });
  }
}
