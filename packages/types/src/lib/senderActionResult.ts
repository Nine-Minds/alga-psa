export type SenderActionFailure = { success: false; error: string };

export function isSenderActionFailure(value: unknown): value is SenderActionFailure {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'success' in value &&
    value.success === false &&
    'error' in value &&
    typeof value.error === 'string',
  );
}
