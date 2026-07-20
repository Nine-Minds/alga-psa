export function chatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  return normalized.endsWith('/chat/completions')
    ? normalized
    : `${normalized}/chat/completions`;
}

export function createProviderHeaders(
  token: string,
  feature: string,
  requestId: string,
): Headers {
  return new Headers({
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Alga-AI-Feature': feature,
    'X-Request-Id': requestId,
  });
}
