import Link from 'next/link';
import { getInstallInfo } from '@ee/lib/actions/extensionDomainActions';

export const metadata = { title: 'Extension' };

export default async function Page({ params }: { params: { id: string } }) {
  const id = params.id;
  let domain: string | null = null;
  let error: string | null = null;
  try {
    const info = await getInstallInfo(id);
    domain = info?.runner_domain ?? null;
  } catch (e: unknown) {
    error = 'Failed to load extension runtime info';
  }

  if (error) {
    return <div className="p-6 text-red-600">{error}</div>;
  }

  if (!domain) {
    return (
      <div className="p-6 space-y-2">
        <div className="text-gray-800 font-medium">Extension runtime domain not available.</div>
        <div className="text-gray-600 text-sm">Reprovision the extension from Settings → Extensions → select extension → Provision.</div>
        <Link href={`/msp/settings/extensions/${'{'}encodeURIComponent(id){'}'}`} className="text-primary-600 hover:underline text-sm">Go to extension details</Link>
      </div>
    );
  }

  const src = `https://${'{'}domain{'}'}`;

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

