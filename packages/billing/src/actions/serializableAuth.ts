import { AuthenticationError } from '@alga-psa/auth';

/** Server actions serialize this result safely when Next sanitizes thrown errors. */
export type UnauthenticatedActionResult = {
  success: false;
  code: 'UNAUTHENTICATED';
  params: Record<string, never>;
  message: string;
  error: string;
};

export function unauthenticatedActionResult(): UnauthenticatedActionResult {
  return {
    success: false,
    code: 'UNAUTHENTICATED',
    params: {},
    message: 'Authentication required',
    error: 'Authentication required',
  };
}

export function withSerializableAuth<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult | UnauthenticatedActionResult> {
  return async (...args) => {
    try {
      return await action(...args);
    } catch (error) {
      if (!(error instanceof AuthenticationError)) throw error;
      return unauthenticatedActionResult();
    }
  };
}
