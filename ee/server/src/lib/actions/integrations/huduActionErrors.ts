import { HuduRequestError } from '../../integrations/hudu/huduClient';
import { HuduCredentialsError } from '../../integrations/hudu/secrets';

export function huduActionErrorMessage(
  error: unknown,
  fallback = 'Unable to complete the Hudu request. Please try again.'
): string {
  if (error instanceof HuduCredentialsError) {
    return 'Hudu API key and base URL must be configured before continuing.';
  }

  if (error instanceof HuduRequestError) {
    switch (error.hudu.kind) {
      case 'invalid_key':
        return 'Hudu rejected the API key. Verify the key and base URL.';
      case 'no_password_access':
        return 'The Hudu API key does not have access to this Hudu resource.';
      case 'not_found':
        return 'Hudu resource not found. Verify the base URL and mapping.';
      case 'validation':
        return 'Hudu rejected the request. Verify the mapping and try again.';
      case 'rate_limited':
        return 'Hudu rate limit exceeded. Please try again later.';
      case 'server_error':
        return 'Hudu is temporarily unavailable. Please try again later.';
      case 'network_error':
        return 'Unable to reach Hudu. Check the Hudu base URL and network connectivity.';
      default:
        return fallback;
    }
  }

  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';

  if (message === 'Forbidden' || message.startsWith('Forbidden:')) {
    return 'You do not have permission to manage Hudu settings.';
  }

  if (
    message === 'Hudu base URL must use HTTPS.' ||
    message === 'Hudu base URL must not target localhost or private network addresses.'
  ) {
    return message;
  }

  if (message.includes('fetch failed') || message.includes('ECONNREFUSED') || message.includes('ENOTFOUND')) {
    return 'Unable to reach Hudu. Check the Hudu base URL and network connectivity.';
  }

  return fallback;
}
