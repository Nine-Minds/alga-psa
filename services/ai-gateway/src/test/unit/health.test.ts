import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { healthzHandler } from '../../http/app.js';

describe('GET /healthz', () => {
  it('returns an OK health response', () => {
    const status = vi.fn();
    const json = vi.fn();
    const response = { status, json } as unknown as Response;
    status.mockReturnValue(response);

    healthzHandler({} as Request, response, vi.fn());

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ status: 'ok' });
  });
});
