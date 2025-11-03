/** @module Interface wasi:http/types@0.2.3 **/
export type FieldKey = string;
export type FieldName = FieldKey;
export type FieldValue = Uint8Array;
export type HeaderError = HeaderErrorInvalidSyntax | HeaderErrorForbidden | HeaderErrorImmutable;
export interface HeaderErrorInvalidSyntax {
  tag: 'invalid-syntax',
}
export interface HeaderErrorForbidden {
  tag: 'forbidden',
}
export interface HeaderErrorImmutable {
  tag: 'immutable',
}
export type Method = MethodGet | MethodHead | MethodPost | MethodPut | MethodDelete | MethodConnect | MethodOptions | MethodTrace | MethodPatch | MethodOther;
export interface MethodGet {
  tag: 'get',
}
export interface MethodHead {
  tag: 'head',
}
export interface MethodPost {
  tag: 'post',
}
export interface MethodPut {
  tag: 'put',
}
export interface MethodDelete {
  tag: 'delete',
}
export interface MethodConnect {
  tag: 'connect',
}
export interface MethodOptions {
  tag: 'options',
}
export interface MethodTrace {
  tag: 'trace',
}
export interface MethodPatch {
  tag: 'patch',
}
export interface MethodOther {
  tag: 'other',
  val: string,
}
export type Scheme = SchemeHttp | SchemeHttps | SchemeOther;
export interface SchemeHttp {
  tag: 'HTTP',
}
export interface SchemeHttps {
  tag: 'HTTPS',
}
export interface SchemeOther {
  tag: 'other',
  val: string,
}
export type Headers = Fields;
export interface DnsErrorPayload {
  rcode?: string,
  infoCode?: number,
}
export interface TlsAlertReceivedPayload {
  alertId?: number,
  alertMessage?: string,
}
export interface FieldSizePayload {
  fieldName?: string,
  fieldSize?: number,
}
export type ErrorCode = ErrorCodeDnsTimeout | ErrorCodeDnsError | ErrorCodeDestinationNotFound | ErrorCodeDestinationUnavailable | ErrorCodeDestinationIpProhibited | ErrorCodeDestinationIpUnroutable | ErrorCodeConnectionRefused | ErrorCodeConnectionTerminated | ErrorCodeConnectionTimeout | ErrorCodeConnectionReadTimeout | ErrorCodeConnectionWriteTimeout | ErrorCodeConnectionLimitReached | ErrorCodeTlsProtocolError | ErrorCodeTlsCertificateError | ErrorCodeTlsAlertReceived | ErrorCodeHttpRequestDenied | ErrorCodeHttpRequestLengthRequired | ErrorCodeHttpRequestBodySize | ErrorCodeHttpRequestMethodInvalid | ErrorCodeHttpRequestUriInvalid | ErrorCodeHttpRequestUriTooLong | ErrorCodeHttpRequestHeaderSectionSize | ErrorCodeHttpRequestHeaderSize | ErrorCodeHttpRequestTrailerSectionSize | ErrorCodeHttpRequestTrailerSize | ErrorCodeHttpResponseIncomplete | ErrorCodeHttpResponseHeaderSectionSize | ErrorCodeHttpResponseHeaderSize | ErrorCodeHttpResponseBodySize | ErrorCodeHttpResponseTrailerSectionSize | ErrorCodeHttpResponseTrailerSize | ErrorCodeHttpResponseTransferCoding | ErrorCodeHttpResponseContentCoding | ErrorCodeHttpResponseTimeout | ErrorCodeHttpUpgradeFailed | ErrorCodeHttpProtocolError | ErrorCodeLoopDetected | ErrorCodeConfigurationError | ErrorCodeInternalError;
export interface ErrorCodeDnsTimeout {
  tag: 'DNS-timeout',
}
export interface ErrorCodeDnsError {
  tag: 'DNS-error',
  val: DnsErrorPayload,
}
export interface ErrorCodeDestinationNotFound {
  tag: 'destination-not-found',
}
export interface ErrorCodeDestinationUnavailable {
  tag: 'destination-unavailable',
}
export interface ErrorCodeDestinationIpProhibited {
  tag: 'destination-IP-prohibited',
}
export interface ErrorCodeDestinationIpUnroutable {
  tag: 'destination-IP-unroutable',
}
export interface ErrorCodeConnectionRefused {
  tag: 'connection-refused',
}
export interface ErrorCodeConnectionTerminated {
  tag: 'connection-terminated',
}
export interface ErrorCodeConnectionTimeout {
  tag: 'connection-timeout',
}
export interface ErrorCodeConnectionReadTimeout {
  tag: 'connection-read-timeout',
}
export interface ErrorCodeConnectionWriteTimeout {
  tag: 'connection-write-timeout',
}
export interface ErrorCodeConnectionLimitReached {
  tag: 'connection-limit-reached',
}
export interface ErrorCodeTlsProtocolError {
  tag: 'TLS-protocol-error',
}
export interface ErrorCodeTlsCertificateError {
  tag: 'TLS-certificate-error',
}
export interface ErrorCodeTlsAlertReceived {
  tag: 'TLS-alert-received',
  val: TlsAlertReceivedPayload,
}
export interface ErrorCodeHttpRequestDenied {
  tag: 'HTTP-request-denied',
}
export interface ErrorCodeHttpRequestLengthRequired {
  tag: 'HTTP-request-length-required',
}
export interface ErrorCodeHttpRequestBodySize {
  tag: 'HTTP-request-body-size',
  val: bigint | undefined,
}
export interface ErrorCodeHttpRequestMethodInvalid {
  tag: 'HTTP-request-method-invalid',
}
export interface ErrorCodeHttpRequestUriInvalid {
  tag: 'HTTP-request-URI-invalid',
}
export interface ErrorCodeHttpRequestUriTooLong {
  tag: 'HTTP-request-URI-too-long',
}
export interface ErrorCodeHttpRequestHeaderSectionSize {
  tag: 'HTTP-request-header-section-size',
  val: number | undefined,
}
export interface ErrorCodeHttpRequestHeaderSize {
  tag: 'HTTP-request-header-size',
  val: FieldSizePayload | undefined,
}
export interface ErrorCodeHttpRequestTrailerSectionSize {
  tag: 'HTTP-request-trailer-section-size',
  val: number | undefined,
}
export interface ErrorCodeHttpRequestTrailerSize {
  tag: 'HTTP-request-trailer-size',
  val: FieldSizePayload,
}
export interface ErrorCodeHttpResponseIncomplete {
  tag: 'HTTP-response-incomplete',
}
export interface ErrorCodeHttpResponseHeaderSectionSize {
  tag: 'HTTP-response-header-section-size',
  val: number | undefined,
}
export interface ErrorCodeHttpResponseHeaderSize {
  tag: 'HTTP-response-header-size',
  val: FieldSizePayload,
}
export interface ErrorCodeHttpResponseBodySize {
  tag: 'HTTP-response-body-size',
  val: bigint | undefined,
}
export interface ErrorCodeHttpResponseTrailerSectionSize {
  tag: 'HTTP-response-trailer-section-size',
  val: number | undefined,
}
export interface ErrorCodeHttpResponseTrailerSize {
  tag: 'HTTP-response-trailer-size',
  val: FieldSizePayload,
}
export interface ErrorCodeHttpResponseTransferCoding {
  tag: 'HTTP-response-transfer-coding',
  val: string | undefined,
}
export interface ErrorCodeHttpResponseContentCoding {
  tag: 'HTTP-response-content-coding',
  val: string | undefined,
}
export interface ErrorCodeHttpResponseTimeout {
  tag: 'HTTP-response-timeout',
}
export interface ErrorCodeHttpUpgradeFailed {
  tag: 'HTTP-upgrade-failed',
}
export interface ErrorCodeHttpProtocolError {
  tag: 'HTTP-protocol-error',
}
export interface ErrorCodeLoopDetected {
  tag: 'loop-detected',
}
export interface ErrorCodeConfigurationError {
  tag: 'configuration-error',
}
export interface ErrorCodeInternalError {
  tag: 'internal-error',
  val: string | undefined,
}
export type StatusCode = number;
export type InputStream = import('./wasi-io-streams.js').InputStream;
export type OutputStream = import('./wasi-io-streams.js').OutputStream;
export type Trailers = Fields;
export type Pollable = import('./wasi-io-poll.js').Pollable;
export type Result<T, E> = { tag: 'ok', val: T } | { tag: 'err', val: E };

export class Fields {
  constructor()
  static fromList(entries: Array<[FieldName, FieldValue]>): Fields;
  get(name: FieldName): Array<FieldValue>;
  has(name: FieldName): boolean;
  set(name: FieldName, value: Array<FieldValue>): void;
  'delete'(name: FieldName): void;
  append(name: FieldName, value: FieldValue): void;
  entries(): Array<[FieldName, FieldValue]>;
  clone(): Fields;
}

export class FutureIncomingResponse {
  /**
   * This type does not have a public constructor.
   */
  private constructor();
  subscribe(): Pollable;
  get(): Result<Result<IncomingResponse, ErrorCode>, void> | undefined;
}

export class IncomingBody {
  /**
   * This type does not have a public constructor.
   */
  private constructor();
  stream(): InputStream;
}

export class IncomingRequest {
  /**
   * This type does not have a public constructor.
   */
  private constructor();
  method(): Method;
  pathWithQuery(): string | undefined;
  scheme(): Scheme | undefined;
  authority(): string | undefined;
  headers(): Headers;
  consume(): IncomingBody;
}

export class IncomingResponse {
  /**
   * This type does not have a public constructor.
   */
  private constructor();
  status(): StatusCode;
  headers(): Headers;
  consume(): IncomingBody;
}

export class OutgoingBody {
  /**
   * This type does not have a public constructor.
   */
  private constructor();
  write(): OutputStream;
  static finish(this_: OutgoingBody, trailers: Trailers | undefined): void;
}

export class OutgoingRequest {
  constructor(headers: Headers)
  body(): OutgoingBody;
  setMethod(method: Method): void;
  setPathWithQuery(pathWithQuery: string | undefined): void;
  setScheme(scheme: Scheme | undefined): void;
  setAuthority(authority: string | undefined): void;
  headers(): Headers;
}

export class OutgoingResponse {
  constructor(headers: Headers)
  setStatusCode(statusCode: StatusCode): void;
  headers(): Headers;
  body(): OutgoingBody;
}

export class RequestOptions {
  /**
   * This type does not have a public constructor.
   */
  private constructor();
}

export class ResponseOutparam {
  /**
   * This type does not have a public constructor.
   */
  private constructor();
  static set(param: ResponseOutparam, response: Result<OutgoingResponse, ErrorCode>): void;
}
