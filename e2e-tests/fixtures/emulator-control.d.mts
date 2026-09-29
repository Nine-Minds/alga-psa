export interface RequestRecordBase {
  sequence: number;
  startedAt: string;
  durationMs: number;
  status: number | null;
  aborted: boolean;
}

export interface HttpRequestRecord extends RequestRecordBase {
  method: string;
  path: string;
}

export interface SmtpRequestRecord extends RequestRecordBase {
  protocol: 'smtp';
  command: 'DATA';
}

export type ProviderRequestRecord = HttpRequestRecord | SmtpRequestRecord;

export interface RequestHistory<RecordType extends ProviderRequestRecord = ProviderRequestRecord> {
  supported: boolean;
  complete: boolean;
  generation: number;
  capacity: number;
  dropped: number;
  inFlight: number;
  requests: RecordType[];
}

export class EmulatorControl {
  constructor(baseURL: string, providers: string[], options?: { timeoutMs?: number });
  readonly baseURL: string;
  readonly providers: string[];
  readonly operations: Array<{ path: string; method: string; status: number }>;
  call<T = unknown>(path: string, body?: unknown): Promise<T>;
  seed<T = unknown>(provider: string, name: string, params: unknown): Promise<T>;
  action<T = unknown>(provider: string, name: string, params?: unknown): Promise<T>;
  arm(provider: string, name: string, params?: unknown): Promise<unknown>;
  disarm(provider: string, name: string): Promise<unknown>;
  state<T = unknown>(provider: string, view: string): Promise<T>;
  requests(provider: 'smtp-sink'): Promise<RequestHistory<SmtpRequestRecord>>;
  requests(provider: 'msgraph' | 'qbo' | 'xero' | 'stripe'): Promise<RequestHistory<HttpRequestRecord>>;
  requests(provider: string): Promise<RequestHistory>;
  reset(): Promise<void>;
  diagnostics(): Promise<{ controlOrigin: string; providers: string[]; operations: EmulatorControl['operations']; requests: Record<string, RequestHistory> }>;
}
