import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CoManagedPortableExport from '@/components/co-managed/CoManagedPortableExport';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.coManagement.export.title', { defaultValue: 'Export Workspace' }),
  };
}

export default function CoManagedPortableExportPage() {
  return <CoManagedFeatureBoundary><CoManagedPortableExport /></CoManagedFeatureBoundary>;
}
