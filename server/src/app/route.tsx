import { getAdminConnection } from '@alga-psa/db/admin';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveDeploymentCapabilities } from '@/lib/deployment/deploymentProfile';
import { resolveRequestHost } from '@/lib/deployment/requestHost';
import { resolveRootRedirect } from '@/lib/deployment/rootRedirect';
import { getPortalDomainByHostname } from 'server/src/models/PortalDomainModel';

export async function GET() {
  const request = { headers: await headers() };
  const capabilities = resolveDeploymentCapabilities();
  const { hostname, hostHeader } = resolveRequestHost(request, capabilities);
  const canonicalHostname = (() => {
    try {
      return process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).hostname : null;
    } catch {
      return null;
    }
  })();
  let adminConnection: Awaited<ReturnType<typeof getAdminConnection>> | null = null;

  const target = await resolveRootRedirect({
    hostname,
    hostHeader,
    canonicalHostname,
    lookupPortalDomain: async (candidate) => {
      adminConnection ??= await getAdminConnection();
      return getPortalDomainByHostname(adminConnection, candidate);
    },
  });

  redirect(target);
}
