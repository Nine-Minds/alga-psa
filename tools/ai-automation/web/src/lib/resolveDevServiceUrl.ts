/**
 * Resolves service URLs for development environments
 * In dev environments, we need to use fully qualified service names
 */
export function resolveDevServiceUrl(url: string): string {
  // Skip if not in dev environment
  if (process.env.ALGA_DEV_ENV !== 'true') {
    return url;
  }

  const namespace = process.env.ALGA_BRANCH_SANITIZED || 'alga-dev-feat-bbl';
  const fullNamespace = `alga-dev-${namespace}`;

  // Map common service names to their fully qualified names
  const serviceMap: Record<string, string> = {
    'code-server': `alga-dev-${namespace}-code-server.${fullNamespace}.svc.cluster.local`,
    'app': `alga-dev-${namespace}.${fullNamespace}.svc.cluster.local`,
    'ai-api': `alga-dev-${namespace}-ai-api.${fullNamespace}.svc.cluster.local`,
    'ai-web': `alga-dev-${namespace}-ai-web.${fullNamespace}.svc.cluster.local`,
  };

  // Check if URL contains a known service name
  for (const [shortName, fullName] of Object.entries(serviceMap)) {
    if (url.includes(`${shortName}:`)) {
      return url.replace(shortName, fullName);
    }
  }

  return url;
}