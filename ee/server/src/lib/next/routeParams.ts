export async function resolveInstallIdFromParamsOrUrl(
  params: unknown,
  reqUrl: string
): Promise<string | undefined> {
  const resolvedParams = await Promise.resolve(params as unknown);

  if (
    resolvedParams &&
    typeof resolvedParams === 'object' &&
    'installId' in resolvedParams &&
    typeof (resolvedParams as { installId?: unknown }).installId === 'string'
  ) {
    const installId = (resolvedParams as { installId: string }).installId;
    if (installId) {
      return installId;
    }
  }

  try {
    const path = new URL(reqUrl).pathname;
    const match = path.match(/\/install\/([^/]+)/);
    if (match?.[1]) {
      return decodeURIComponent(match[1]);
    }
  } catch {
    // ignore
  }

  return undefined;
}

