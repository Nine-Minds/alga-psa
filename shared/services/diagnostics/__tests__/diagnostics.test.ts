import { describe, it, expect, vi } from 'vitest';
import { createDiagnosticsRunner } from '../runner';
import { computeOverallStatus } from '../status';
import { classifyGraphFailure, extractGraphIds } from '../graphFailure';
import { buildTokenFingerprint, decodeJwtPayload } from '../fingerprint';

describe('createDiagnosticsRunner', () => {
  it('times pass and warn steps and preserves http/data', async () => {
    const runner = createDiagnosticsRunner();
    await runner.runStep('a', 'First', async () => ({
      status: 'pass',
      http: { method: 'GET', path: '/a', requestId: 'rid-a' },
      data: { value: 1 },
    }));
    await runner.runStep('b', 'Second', async () => ({
      status: 'warn',
      error: { message: 'careful' },
    }));

    expect(runner.steps).toHaveLength(2);
    expect(runner.steps[0]).toMatchObject({
      id: 'a',
      title: 'First',
      status: 'pass',
      data: { value: 1 },
    });
    expect(runner.steps[0].http?.requestId).toBe('rid-a');
    expect(typeof runner.steps[0].durationMs).toBe('number');
    expect(runner.steps[1].status).toBe('warn');
  });

  it('turns unexpected errors into safe fails with correlation metadata and keeps running', async () => {
    const classifyError = vi.fn((error: unknown) => {
      const failure = classifyGraphFailure(error);
      return {
        message: failure.message,
        status: failure.status,
        code: failure.code,
        requestId: failure.requestId,
      };
    });
    const onError = vi.fn();
    const runner = createDiagnosticsRunner({ classifyError, onError });

    const thrown = {
      response: {
        status: 403,
        data: { error: { code: 'Authorization_RequestDenied', message: 'nope' } },
        headers: { 'request-id': 'rid-403' },
      },
    };

    await runner.runStep('boom', 'Explodes', async () => {
      throw thrown;
    });
    await runner.runStep('after', 'Still runs', async () => ({ status: 'pass' }));

    expect(runner.steps).toHaveLength(2);
    expect(runner.steps[0].status).toBe('fail');
    expect(runner.steps[0].error).toMatchObject({
      status: 403,
      code: 'Authorization_RequestDenied',
      requestId: 'rid-403',
    });
    expect(runner.steps[1].status).toBe('pass');
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe('computeOverallStatus', () => {
  it.each([
    [[{ status: 'pass' }, { status: 'pass' }], 'pass'],
    [[{ status: 'pass' }, { status: 'warn' }], 'warn'],
    [[{ status: 'warn' }, { status: 'fail' }], 'fail'],
    [[{ status: 'pass' }, { status: 'skip' }], 'pass'],
    [[{ status: 'skip' }, { status: 'skip' }], 'pass'],
  ])('folds %j to %s', (steps, expected) => {
    expect(computeOverallStatus(steps as any)).toBe(expected);
  });
});

describe('classifyGraphFailure / extractGraphIds', () => {
  it('extracts request headers case-insensitively', () => {
    expect(extractGraphIds({ 'request-id': 'r1', 'client-request-id': 'c1' })).toEqual({
      requestId: 'r1',
      clientRequestId: 'c1',
    });
  });

  it('classifies a Graph error body and never exposes the raw request', () => {
    const request = { headers: { Authorization: 'Bearer secret' } };
    const failure = classifyGraphFailure({
      request,
      response: {
        status: 400,
        data: { error: { code: 'BadRequest', message: 'bad' } },
        headers: { 'request-id': 'rid' },
      },
    });
    expect(failure).toMatchObject({ status: 400, code: 'BadRequest', message: 'bad', requestId: 'rid' });
    expect(JSON.stringify(failure)).not.toContain('secret');
  });
});

describe('token fingerprint / decode', () => {
  it('builds a partial fingerprint and decodes jwt claims', () => {
    const payload = Buffer.from(JSON.stringify({ tid: 'abc' })).toString('base64url');
    const token = `header.${payload}.sig`;
    expect(buildTokenFingerprint(token)).toMatch(/^head\.\.\.\(\d+\)$/);
    expect(decodeJwtPayload(token)).toEqual({ tid: 'abc' });
  });
});
