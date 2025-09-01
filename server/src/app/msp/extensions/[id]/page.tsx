'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getInstallInfo } from '@ee/lib/actions/extensionDomainActions';

export default function ExtensionAppPage() {
  const params = useParams();
  const id = String(params?.id || '');
  const [domain, setDomain] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const info = await getInstallInfo(id).catch(() => null);
        if (!mounted) return;
        setDomain(info?.runner_domain ?? null);
      } catch (e: any) {
        if (!mounted) return;
        setError('Failed to load extension runtime info');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [id]);

  if (!id) {
    return <div className="p-6 text-red-600">Missing extension id</div>;
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-3 text-gray-600">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
        Loading extension...
      </div>
    );
  }

  if (error) {
    return <div className="p-6 text-red-600">{error}</div>;
  }

  if (!domain) {
    return (
      <div className="p-6 space-y-2">
        <div className="text-gray-800 font-medium">Extension runtime domain not available.</div>
        <div className="text-gray-600 text-sm">Reprovision the extension from Settings → Extensions → select extension → Provision.</div>
        <Link href={`/msp/settings/extensions/${encodeURIComponent(id)}`} className="text-primary-600 hover:underline text-sm">Go to extension details</Link>
      </div>
    );
  }

  const src = `https://${domain}`;

  return (
    <div className="h-[calc(100vh-64px)] w-full">
      <iframe
        key={src}
        src={src}
        title="Extension App"
        className="w-full h-full border-0"
        sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
      />
    </div>
  );
}
