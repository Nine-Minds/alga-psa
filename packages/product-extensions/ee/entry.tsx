/* global process */

import Link from 'next/link';
import type { Metadata } from 'next';
import ExtensionIframe from './ExtensionIframe';
import DockerExtensionIframe from './DockerExtensionIframe';
import { getInstallInfo } from '@ee/lib/actions/extensionDomainActions';
import { buildExtUiSrc } from './lib/extensions/assets/url.shared';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type PageParams = { id: string };

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'msp/extensions');

  return {
    title: t('runtime.metadataTitle', { defaultValue: 'Extension' }),
  };
}

export default async function Page({ params }: { params: PageParams | Promise<PageParams> }) {
  const { t } = await getServerTranslation(undefined, 'msp/extensions');
  const resolvedParams = await params;
  const id = resolvedParams.id;
  const runnerBackend = (process.env.RUNNER_BACKEND || 'knative').toLowerCase();
  if (process.env.NODE_ENV !== 'production') {
    console.log('[extensions] env snapshot', {
      runnerBackend,
      extUiHostMode: process.env.EXT_UI_HOST_MODE,
      runnerPublicBase: process.env.RUNNER_PUBLIC_BASE,
      runnerDockerPort: process.env.RUNNER_DOCKER_PORT,
    });
  }

  let error: string | null = null;
  let info: Awaited<ReturnType<typeof getInstallInfo>> = null;

  try {
    info = await getInstallInfo(id);
  } catch {
    error = t('runtime.loadError', { defaultValue: 'Failed to load extension runtime info' });
  }

  if (error) {
    return <div className="p-6 text-red-600">{error}</div>;
  }

  if (!info) {
    return (
      <div className="p-6 space-y-2">
        <div className="text-gray-800 font-medium">
          {t('runtime.notFoundTitle', { defaultValue: 'Extension not found.' })}
        </div>
        <Link href="/msp/settings/extensions" className="text-primary-600 hover:underline text-sm">
          {t('runtime.goToExtensions', { defaultValue: 'Go to extensions' })}
        </Link>
      </div>
    );
  }

  // Docker backend mode: Use content-hash based URLs served from same origin
  if (runnerBackend === 'docker') {
    if (!info.content_hash) {
      return (
        <div className="p-6 space-y-2">
          <div className="text-gray-800 font-medium">
            {t('runtime.bundleUnavailableTitle', { defaultValue: 'Extension bundle not available.' })}
          </div>
          <div className="text-gray-600 text-sm">
            {t('runtime.bundleUnavailableDescription', {
              defaultValue: 'The extension bundle is missing or has not been uploaded.',
            })}
          </div>
          <Link href={`/msp/settings/extensions/${encodeURIComponent(id)}`} className="text-primary-600 hover:underline text-sm">
            {t('runtime.goToDetails', { defaultValue: 'Go to extension details' })}
          </Link>
        </div>
      );
    }

    const uiHostMode = (process.env.EXT_UI_HOST_MODE || '').toLowerCase();
    const nextJsOverride =
      uiHostMode === 'nextjs' && process.env.RUNNER_PUBLIC_BASE
        ? { publicBaseOverride: process.env.RUNNER_PUBLIC_BASE }
        : undefined;
    const iframeSrc = buildExtUiSrc(id, info.content_hash, '/', {
      tenantId: info.tenant_id,
      ...(nextJsOverride ?? {}),
    });
    console.log('[extensions] iframeSrc', { iframeSrc, uiHostMode, runnerBackend });

    const debugBanner = (
      <pre className="text-xs text-gray-500 p-2 bg-gray-50 border border-gray-200 rounded">
        docker-mode
        {' '}
        {JSON.stringify(
          {
            runnerBackend,
            extUiHostMode: process.env.EXT_UI_HOST_MODE,
            runnerPublicBase: process.env.RUNNER_PUBLIC_BASE,
            runnerDockerPort: process.env.RUNNER_DOCKER_PORT,
          },
          null,
          2,
        )}
      </pre>
    );

    return (
      <div className="flex-1 h-full w-full flex flex-col min-h-0">
        <DockerExtensionIframe src={iframeSrc} extensionId={id} />
        {debugBanner}
      </div>
    );
  }

  // Knative backend mode: Use custom domain approach
  if (!info.runner_domain) {
    return (
      <div className="p-6 space-y-2">
        <div className="text-gray-800 font-medium">
          {t('runtime.runtimeDomainUnavailableTitle', {
            defaultValue: 'Extension runtime domain not available.',
          })}
        </div>
        <div className="text-gray-600 text-sm">
          {t('runtime.runtimeDomainUnavailableDescription', {
            defaultValue:
              'Reprovision the extension from Settings -> Extensions -> select extension -> Provision.',
          })}
        </div>
        <Link href={`/msp/settings/extensions/${encodeURIComponent(id)}`} className="text-primary-600 hover:underline text-sm">
          {t('runtime.goToDetails', { defaultValue: 'Go to extension details' })}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex-1 h-full w-full flex flex-col min-h-0">
      <ExtensionIframe domain={info.runner_domain} extensionId={id} contentHash={info.content_hash} />
    </div>
  );
}
