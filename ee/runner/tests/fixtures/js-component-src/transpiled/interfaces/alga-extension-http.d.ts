/** @module Interface alga:extension/http **/
export function fetch(request: HttpRequest): HttpResponse;
export type HttpRequest = import('./alga-extension-types.js').HttpRequest;
export type HttpResponse = import('./alga-extension-types.js').HttpResponse;
export type HttpError = import('./alga-extension-types.js').HttpError;
