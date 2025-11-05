import Link from 'next/link';
import ExtensionIframe from './ExtensionIframe';
import DockerExtensionIframe from './DockerExtensionIframe';
import { getInstallInfo } from '@ee/lib/actions/extensionDomainActions';
import { buildExtUiSrc } from 'server/src/lib/extensions/assets/url.shared';

export const metadata = { title: 'Extension' };

export default async function Page({ params }: { params: { id: string } }) {
  const id = params.id;
  const runnerBackend = (process.env.RUNNER_BACKEND || 'knative').toLowerCase();

  let error: string | null = null;
  let info: Awaited<ReturnType<typeof getInstallInfo>> = null;

  try {
    info = await getInstallInfo(id);
  } catch (e: unknown) {
    error = 'Failed to load extension runtime info';
  }

  if (error) {
    return <div className="p-6 text-red-600">{error}</div>;
  }

  if (!info) {
    return (
      <div className="p-6 space-y-2">
        <div className="text-gray-800 font-medium">Extension not found.</div>
        <Link href="/msp/settings/extensions" className="text-primary-600 hover:underline text-sm">Go to extensions</Link>
      </div>
    );
  }

  // Docker backend mode: Use content-hash based URLs served from same origin
  if (runnerBackend === 'docker') {
    if (!info.content_hash) {
      return (
        <div className="p-6 space-y-2">
          <div className="text-gray-800 font-medium">Extension bundle not available.</div>
          <div className="text-gray-600 text-sm">The extension bundle is missing or has not been uploaded.</div>
          <Link href={`/msp/settings/extensions/${encodeURIComponent(id)}`} className="text-primary-600 hover:underline text-sm">Go to extension details</Link>
        </div>
      );
    }

    // Build path-based iframe URL
    const rawPublicBase = process.env.RUNNER_PUBLIC_BASE?.trim();
    const dockerBase =
      rawPublicBase && /^https?:\/\//i.test(rawPublicBase)
        ? rawPublicBase
        : `http://localhost:${process.env.RUNNER_DOCKER_PORT || '8085'}`;
    const iframeSrc = buildExtUiSrc(id, info.content_hash, '/', {
      tenantId: info.tenant_id,
      publicBaseOverride: dockerBase,
    });

    return (
      <div className="h-full w-full">
        <DockerExtensionIframe src={iframeSrc} />
      </div>
    );
  }

  // Knative backend mode: Use custom domain approach
  if (!info.runner_domain) {
    return (
      <div className="p-6 space-y-2">
        <div className="text-gray-800 font-medium">Extension runtime domain not available.</div>
        <div className="text-gray-600 text-sm">Reprovision the extension from Settings → Extensions → select extension → Provision.</div>
        <Link href={`/msp/settings/extensions/${encodeURIComponent(id)}`} className="text-primary-600 hover:underline text-sm">Go to extension details</Link>
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <ExtensionIframe domain={info.runner_domain} />
    </div>
  );
}
