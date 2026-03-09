import { vi } from 'vitest';
import type { IExecuteFunctions, ILoadOptionsFunctions, IHttpRequestOptions } from 'n8n-workflow';

interface ExecuteHarnessOptions {
  items: Array<Record<string, unknown>>;
  continueOnFail?: boolean;
  requestHandler: (options: IHttpRequestOptions, index: number) => Promise<unknown> | unknown;
}

export function createExecuteHarness(options: ExecuteHarnessOptions) {
  const requests: IHttpRequestOptions[] = [];
  let requestIndex = 0;

  const context: IExecuteFunctions = {
    getInputData: () => options.items.map(() => ({ json: {} })),
    getNodeParameter: (name: string, itemIndex: number, fallback?: unknown) => {
      const value = options.items[itemIndex]?.[name];
      return value === undefined ? fallback : value;
    },
    continueOnFail: () => Boolean(options.continueOnFail),
    getNode: () => ({
      id: '1',
      name: 'Alga PSA',
      type: 'n8n-nodes-alga-psa.algaPsa',
      typeVersion: 1,
      position: [0, 0],
      parameters: {},
    }),
    getCredentials: vi.fn(async () => ({
      baseUrl: 'https://api.algapsa.test/',
      apiKey: 'super-secret-api-key',
    })),
    helpers: {
      httpRequest: vi.fn(async (requestOptions: IHttpRequestOptions) => {
        requests.push(requestOptions);
        const currentIndex = requestIndex;
        requestIndex += 1;
        const response = await options.requestHandler(requestOptions, currentIndex);
        return response;
      }),
    },
  } as unknown as IExecuteFunctions;

  return { context, requests };
}

interface LoadHarnessOptions {
  requestHandler: (options: IHttpRequestOptions) => Promise<unknown> | unknown;
  currentNodeParameters?: Record<string, unknown>;
}

export function createLoadOptionsHarness(options: LoadHarnessOptions): ILoadOptionsFunctions {
  const currentNodeParameters = options.currentNodeParameters ?? {};

  return {
    getCredentials: vi.fn(async () => ({
      baseUrl: 'https://api.algapsa.test/',
      apiKey: 'super-secret-api-key',
    })),
    getNodeParameter: vi.fn((name: string, fallback?: unknown) => {
      const value = currentNodeParameters[name];
      return value === undefined ? fallback : value;
    }),
    getCurrentNodeParameter: vi.fn((name: string) => currentNodeParameters[name]),
    getCurrentNodeParameters: vi.fn(() => currentNodeParameters),
    helpers: {
      httpRequest: vi.fn(async (requestOptions: IHttpRequestOptions) =>
        options.requestHandler(requestOptions),
      ),
    },
  } as unknown as ILoadOptionsFunctions;
}

export function createApiError(
  statusCode: number,
  code: string,
  message: string,
  details?: unknown,
): Error & Record<string, unknown> {
  const error = new Error(message) as Error & Record<string, unknown>;
  error.statusCode = statusCode;
  error.response = {
    status: statusCode,
    data: {
      error: {
        code,
        message,
        details,
      },
    },
  };

  return error;
}
