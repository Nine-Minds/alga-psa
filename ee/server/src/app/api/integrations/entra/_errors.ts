export function entraRouteErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';

  if (
    message === 'No active Entra connection exists for this tenant.' ||
    message === 'Microsoft credentials are not configured for direct Entra token refresh.' ||
    message === 'No direct Entra refresh token is stored for this tenant.' ||
    message === 'Direct Entra token refresh response was missing required fields.'
  ) {
    return message;
  }

  return fallback;
}
