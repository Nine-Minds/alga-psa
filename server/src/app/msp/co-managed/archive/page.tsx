import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import CoManagedArchive from '@/components/co-managed/CoManagedArchive';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.coManaged.archive.title', { defaultValue: 'Shared Work Archive' }),
  };
}
export default function CoManagedArchivePage() { return <CoManagedArchive />; }
