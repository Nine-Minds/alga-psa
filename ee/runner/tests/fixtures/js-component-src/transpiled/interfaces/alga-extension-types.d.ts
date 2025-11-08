/** @module Interface alga:extension/types **/
export interface ContextData {
  requestId?: string,
  tenantId: string,
  extensionId: string,
  installId?: string,
  versionId?: string,
}
export interface HttpHeader {
  name: string,
  value: string,
}
export interface HttpRequest {
  method: string,
  url: string,
  headers: Array<HttpHeader>,
  body?: Uint8Array,
}
export interface ExecuteRequest {
  context: ContextData,
  http: HttpRequest,
}
export interface ExecuteResponse {
  status: number,
  headers: Array<HttpHeader>,
  body?: Uint8Array,
}
/**
 * # Variants
 * 
 * ## `"missing"`
 * 
 * ## `"denied"`
 * 
 * ## `"expired"`
 * 
 * ## `"internal"`
 */
export type SecretError = 'missing' | 'denied' | 'expired' | 'internal';
export interface HttpResponse {
  status: number,
  headers: Array<HttpHeader>,
  body?: Uint8Array,
}
/**
 * # Variants
 * 
 * ## `"invalid-url"`
 * 
 * ## `"not-allowed"`
 * 
 * ## `"transport"`
 * 
 * ## `"internal"`
 */
export type HttpError = 'invalid-url' | 'not-allowed' | 'transport' | 'internal';
export interface StorageEntry {
  namespace: string,
  key: string,
  value: Uint8Array,
  revision?: bigint,
}
/**
 * # Variants
 * 
 * ## `"missing"`
 * 
 * ## `"conflict"`
 * 
 * ## `"denied"`
 * 
 * ## `"internal"`
 */
export type StorageError = 'missing' | 'conflict' | 'denied' | 'internal';
/**
 * # Variants
 * 
 * ## `"route-not-found"`
 * 
 * ## `"denied"`
 * 
 * ## `"bad-request"`
 * 
 * ## `"internal"`
 */
export type ProxyError = 'route-not-found' | 'denied' | 'bad-request' | 'internal';
