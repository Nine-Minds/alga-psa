export type RmmSyncTransport = 'direct' | 'temporal';

export interface RmmSyncExecutionContext<TInput> {
  provider: string;
  operation: string;
  input: TInput;
}

export interface RmmSyncTransportOptions<TInput, TResult> {
  context: RmmSyncExecutionContext<TInput>;
  directExecutor: (context: RmmSyncExecutionContext<TInput>) => Promise<TResult>;
  temporalExecutor?: (context: RmmSyncExecutionContext<TInput>) => Promise<TResult>;
  transportOverride?: RmmSyncTransport;
}

export function resolveRmmSyncTransport(
  provider: string,
  transportOverride?: RmmSyncTransport
): RmmSyncTransport {
  if (transportOverride) return transportOverride;

  const specific = process.env[`${provider.toUpperCase()}_SYNC_TRANSPORT`];
  if (specific === 'temporal' || specific === 'direct') {
    return specific;
  }

  const globalSetting = process.env.RMM_SYNC_TRANSPORT;
  if (globalSetting === 'temporal' || globalSetting === 'direct') {
    return globalSetting;
  }

  return 'direct';
}

export async function runRmmSyncWithTransport<TInput, TResult>(
  options: RmmSyncTransportOptions<TInput, TResult>
): Promise<TResult> {
  const transport = resolveRmmSyncTransport(options.context.provider, options.transportOverride);

  if (transport === 'temporal' && options.temporalExecutor) {
    return options.temporalExecutor(options.context);
  }

  return options.directExecutor(options.context);
}
