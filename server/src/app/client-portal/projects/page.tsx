import { ProjectsOverviewPage } from '@alga-psa/client-portal/components';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('clientPortal.projects.title', { defaultValue: 'Projects' }),
  };
}

export default function ProjectsPage() {
  return <ProjectsOverviewPage />;
}
