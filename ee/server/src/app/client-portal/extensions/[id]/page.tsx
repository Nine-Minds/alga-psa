import React from 'react';
import Link from 'next/link';
import ExtensionIframe from '@product/extensions/ee/ExtensionIframe';
import DockerExtensionIframe from '@product/extensions/ee/DockerExtensionIframe';
import { getInstallInfo } from '@ee/lib/actions/extensionDomainActions';
import { buildExtUiSrc } from 'server/src/lib/extensions/assets/url.shared';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type PageParams = { id: string };

export default async function ExtensionPage({ params }: { params: PageParams | Promise<PageParams> }) {
  const resolvedParams = await params;
  const id = resolvedParams.id;
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
        <Link href="/client-portal/dashboard" className="text-primary-600 hover:underline text-sm">Back to Dashboard</Link>
      </div>
    );
  }

  // Docker backend mode
  if (runnerBackend === 'docker') {
    if (!info.content_hash) {
      return (
        <div className="p-6 space-y-2">
          <div className="text-gray-800 font-medium">Extension bundle not available.</div>
          <div className="text-gray-600 text-sm">The extension bundle is missing or has not been uploaded.</div>
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
      <div className="h-full w-full min-h-[calc(100vh-100px)]">
        <DockerExtensionIframe src={iframeSrc} />
      </div>
    );
  }

  // Knative backend mode
  if (!info.runner_domain) {
    return (
      <div className="p-6 space-y-2">
        <div className="text-gray-800 font-medium">Extension runtime domain not available.</div>
        <div className="text-gray-600 text-sm">Extension domain not provisioned.</div>
      </div>
    );
  }

  return (
    <div className="h-full w-full min-h-[calc(100vh-100px)]">
      <ExtensionIframe domain={info.runner_domain} />
    </div>
  );
}
