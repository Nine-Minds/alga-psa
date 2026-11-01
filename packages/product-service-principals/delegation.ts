// Delegation (act-as) header handling shared by both editions. A delegation
// header is only meaningful on a service-principal key, which the EE boundary
// resolves. Any other key that sends one is rejected rather than silently
// ignored, so a caller never believes work was attributed to someone else.
export const DELEGATION_HEADER_NAMES = ['x-alga-act-as'] as const;

export class DelegationNotSupportedError extends Error {
  readonly code = 'ACT_AS_NOT_SUPPORTED';
  readonly statusCode = 400;
  constructor() {
    super('Delegation headers are only supported on service-principal API keys');
    this.name = 'DelegationNotSupportedError';
  }
}

export function assertNoDelegationHeaders(req: Pick<Request, 'headers'>): void {
  for (const name of DELEGATION_HEADER_NAMES) {
    if (req.headers.get(name)) throw new DelegationNotSupportedError();
  }
}
