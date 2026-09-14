// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ApiEmailTemplateController } from '../../../lib/api/controllers/ApiEmailTemplateController';
import {
  emailTemplateDeleteQuerySchema,
  emailTemplateListQuerySchema,
  emailTemplateNameSchema,
  updateEmailTemplateSchema,
} from '../../../lib/api/schemas/emailTemplateSchemas';

const BASE = 'http://localhost:3000/api/v1/email/templates';

const request = (url: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const forbidden = Object.assign(new Error('Permission denied'), { statusCode: 403, code: 'FORBIDDEN' });

describe('email template API auth', () => {
  it('rejects every endpoint without an API key', async () => {
    const controller = new ApiEmailTemplateController();
    const calls: Array<Promise<Response>> = [
      controller.list()(request(BASE, 'GET')),
      controller.getByName()(request(`${BASE}/ticket-created`, 'GET')),
      controller.updateByName()(request(`${BASE}/ticket-created`, 'PUT', { language_code: 'en', subject: 'x' })),
      controller.deleteByName()(request(`${BASE}/ticket-created?language=en`, 'DELETE')),
    ];

    for (const call of calls) {
      expect((await call).status).toBe(401);
    }
  });

  it('checks the settings permission before reaching the service', async () => {
    const controller = new ApiEmailTemplateController();
    const service = (controller as any).emailTemplateService;
    const upsertSpy = vi.spyOn(service, 'upsertOverride');
    const listSpy = vi.spyOn(service, 'list');

    vi.spyOn(controller as any, 'authenticate').mockResolvedValue(
      Object.assign(request(`${BASE}/ticket-created`, 'PUT', { language_code: 'en', subject: 'x' }), {
        context: { tenant: 'tenant-oz', userId: 'user-1', user: {} },
      }),
    );
    vi.spyOn(controller as any, 'runWithApiKeyContext').mockImplementation((_req: unknown, fn: any) => fn());
    vi.spyOn(controller as any, 'checkPermission').mockRejectedValue(forbidden);

    const updateResponse = await controller.updateByName()(request(`${BASE}/ticket-created`, 'PUT', { language_code: 'en', subject: 'x' }));
    const listResponse = await controller.list()(request(BASE, 'GET'));

    expect(updateResponse.status).toBe(403);
    expect(listResponse.status).toBe(403);
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(listSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('rejects a template name that is not kebab-case before any work happens', async () => {
    const controller = new ApiEmailTemplateController();
    const service = (controller as any).emailTemplateService;
    const getSpy = vi.spyOn(service, 'getByName');

    vi.spyOn(controller as any, 'authenticate').mockResolvedValue(
      Object.assign(request(`${BASE}/..%2Fsecrets`, 'GET'), {
        context: { tenant: 'tenant-oz', userId: 'user-1', user: {} },
      }),
    );
    vi.spyOn(controller as any, 'runWithApiKeyContext').mockImplementation((_req: unknown, fn: any) => fn());
    vi.spyOn(controller as any, 'checkPermission').mockResolvedValue(undefined);

    const response = await controller.getByName()(request(`${BASE}/..%2Fsecrets`, 'GET'));

    expect(response.status).toBe(400);
    expect(getSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe('email template API validation', () => {
  it('accepts a partial edit and requires a language', () => {
    expect(updateEmailTemplateSchema.safeParse({ language_code: 'en', subject: 'Hi' }).success).toBe(true);
    expect(updateEmailTemplateSchema.safeParse({ subject: 'Hi' }).success).toBe(false);
    expect(updateEmailTemplateSchema.safeParse({ language_code: 'klingon', subject: 'Hi' }).success).toBe(false);
  });

  it('requires at least one field to write and rejects unknown ones', () => {
    expect(updateEmailTemplateSchema.safeParse({ language_code: 'en' }).success).toBe(false);
    expect(updateEmailTemplateSchema.safeParse({ language_code: 'en', subject: '' }).success).toBe(false);
    expect(updateEmailTemplateSchema.safeParse({ language_code: 'en', subject: 'Hi', tenant: 'other' }).success).toBe(false);
    expect(updateEmailTemplateSchema.safeParse({ language_code: 'en', name: 'other-template' }).success).toBe(false);
  });

  it('caps the stored bodies', () => {
    const huge = 'x'.repeat(256 * 1024 + 1);

    expect(updateEmailTemplateSchema.safeParse({ language_code: 'en', html_content: huge }).success).toBe(false);
    expect(updateEmailTemplateSchema.safeParse({ language_code: 'en', text_content: huge }).success).toBe(false);
  });

  it('constrains names and query parameters', () => {
    expect(emailTemplateNameSchema.safeParse('ticket-created').success).toBe(true);
    expect(emailTemplateNameSchema.safeParse('Ticket Created').success).toBe(false);
    expect(emailTemplateNameSchema.safeParse('../etc/passwd').success).toBe(false);
    expect(emailTemplateListQuerySchema.safeParse({ limit: '10' }).data?.limit).toBe(10);
    expect(emailTemplateListQuerySchema.safeParse({ limit: '1000' }).success).toBe(false);
    expect(emailTemplateDeleteQuerySchema.safeParse({}).success).toBe(false);
  });
});
