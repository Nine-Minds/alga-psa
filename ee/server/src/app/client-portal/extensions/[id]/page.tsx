import React from 'react';
import Link from 'next/link';
import ExtensionIframe from '@product/extensions/ee/ExtensionIframe';
import DockerExtensionIframe from '@product/extensions/ee/DockerExtensionIframe';
import { getInstallInfo } from '@ee/lib/actions/extensionDomainActions';
import { buildExtUiSrc } from 'server/src/lib/extensions/assets/url.shared';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Extension',
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type PageParams = { id: string };

export default async function ExtensionPage({ params }: { params: PageParams | Promise<PageParams> }) {
  const resolvedParams = await params;
  const id = resolvedParams.id;
  const runnerBackend = (process.env.RUNNER_BACKEND || 'knative').toLowerCase();
  const { t } = await getServerTranslation(undefined, 'msp/extensions');

  let error: string | null = null;
  let info: Awaited<ReturnType<typeof getInstallInfo>> = null;

  try {
    info = await getInstallInfo(id);
  } catch (e: unknown) {
    error = t('clientPortal.loadError');
  }

  if (error) {
    return <div className="p-6 text-red-600">{error}</div>;
  }

  if (!info) {
    return (
      <div className="p-6 space-y-2">
        <div className="text-gray-800 font-medium">{t('clientPortal.notFoundTitle')}</div>
        <Link href="/client-portal/dashboard" className="text-primary-600 hover:underline text-sm">{t('clientPortal.backToDashboard')}</Link>
      </div>
    );
  }

  // Docker backend mode
  if (runnerBackend === 'docker') {
    if (!info.content_hash) {
      return (
        <div className="p-6 space-y-2">
          <div className="text-gray-800 font-medium">{t('clientPortal.bundleUnavailableTitle')}</div>
          <div className="text-gray-600 text-sm">{t('clientPortal.bundleUnavailableDescription')}</div>
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

    return (
      <div className="flex-1 w-full flex flex-col min-h-0">
        <DockerExtensionIframe src={iframeSrc} extensionId={id} />
      </div>
    );
  }

  // Knative backend mode
  if (!info.runner_domain) {
    return (
      <div className="p-6 space-y-2">
        <div className="text-gray-800 font-medium">{t('clientPortal.runtimeDomainUnavailableTitle')}</div>
        <div className="text-gray-600 text-sm">{t('clientPortal.runtimeDomainUnavailableDescription')}</div>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full flex flex-col min-h-0">
      <ExtensionIframe domain={info.runner_domain} extensionId={id} />
    </div>
  );
}
