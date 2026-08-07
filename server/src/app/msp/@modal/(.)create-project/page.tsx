import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import CreateProjectRouteClient from '../../_components/CreateProjectRouteClient';
import WorkspaceRouteLayout from '../../_components/WorkspaceRouteLayout';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.createProject.title', { defaultValue: 'Create Project' }),
  };
}

export default function CreateProjectModalPage() {
  return (
    <WorkspaceRouteLayout>
      <CreateProjectRouteClient closeMode="back" />
    </WorkspaceRouteLayout>
  );
}
