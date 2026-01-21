// Re-export Next.js server types to work around module resolution issues
declare module 'next/server' {
  import { NextURL } from 'next/dist/server/web/next-url';
  import { RequestCookies } from 'next/dist/server/web/spec-extension/cookies';
  import { ResponseCookies } from 'next/dist/server/web/spec-extension/cookies';

  export class NextRequest extends Request {
    constructor(input: URL | RequestInfo, init?: RequestInit);
    get cookies(): RequestCookies;
    get nextUrl(): NextURL;
    get url(): string;
    get headers(): Headers;
    get method(): string;
    json(): Promise<any>;
    text(): Promise<string>;
    formData(): Promise<FormData>;
    arrayBuffer(): Promise<ArrayBuffer>;
    blob(): Promise<Blob>;
  }

  export class NextResponse<Body = unknown> extends Response {
    get cookies(): ResponseCookies;
    static json<JsonBody>(body: JsonBody, init?: ResponseInit): NextResponse<JsonBody>;
    static redirect(url: string | NextURL | URL, init?: number | ResponseInit): NextResponse<unknown>;
    static rewrite(destination: string | NextURL | URL, init?: any): NextResponse<unknown>;
    static next(init?: any): NextResponse<unknown>;
  }

  export { NextFetchEvent } from 'next/dist/server/web/spec-extension/fetch-event';
  export { NextMiddleware, MiddlewareConfig } from 'next/dist/server/web/types';
  export { userAgent, userAgentFromString } from 'next/dist/server/web/spec-extension/user-agent';
  export { URLPattern } from 'next/dist/compiled/@edge-runtime/primitives/url';
  export { ImageResponse } from 'next/dist/server/web/spec-extension/image-response';
  export type { ImageResponseOptions } from 'next/dist/compiled/@vercel/og/types';
}

// Re-export vitest types to work around module resolution issues
declare module 'vitest' {
  export {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    it,
    test,
    expect,
    vi,
    suite,
    onTestFailed,
    onTestFinished
  } from '@vitest/runner';
  export * from 'vitest/dist/index';
}
