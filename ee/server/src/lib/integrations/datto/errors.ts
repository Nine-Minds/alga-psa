import axios, { AxiosError } from 'axios';

/**
 * Maps an axios failure to a user-facing message that never carries URLs,
 * headers, or response bodies (which may echo credentials). `label` is the
 * provider's display name, e.g. 'Tactical RMM' or 'Datto RMM'.
 */
export function axiosErrorToMessage(err: unknown, label: string = 'RMM'): string {
  if (axios.isAxiosError(err)) {
    const ax = err as AxiosError<any>;
    const status = ax.response?.status;
    if (!status) {
      return `Unable to reach ${label}. Check the instance URL and network access.`;
    }
    if (status === 400) {
      return `${label} rejected the request. Check the configured URL and credentials.`;
    }
    if (status === 401) {
      return `${label} credentials are invalid or expired. Reconnect the integration.`;
    }
    if (status === 403) {
      return `${label} rejected the request because the configured account does not have permission.`;
    }
    if (status === 404) {
      return `${label} endpoint was not found. Check the instance URL and API access.`;
    }
    if (status === 429) {
      return `${label} rate limit was reached. Try again later.`;
    }
    if (status >= 500) {
      return `${label} is temporarily unavailable. Try again later.`;
    }
    return `${label} request failed with status ${status}.`;
  }

  return `${label} operation failed. Please try again.`;
}
