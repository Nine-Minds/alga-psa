import CoManagedEffort from '@/components/co-managed/CoManagedEffort';
import { getCurrentTenantProduct } from '@/lib/productAccess';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { getProject } from '@alga-psa/projects/actions/projectActions';
import { AIChatContextBoundary } from '@product/chat/context';
import MspProjectPageClient from '@alga-psa/msp-composition/projects/MspProjectPageClient';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try {
    const { id } = await params;
    const project = await getProject(id);
    if (project && 'project_name' in project) {
      return { title: project.project_name };
    }
  } catch (error) {
    console.error('[generateMetadata] Failed to fetch project title:', error);
  }
  const { t } = await getServerTranslation(undefined, 'metadata');
  return { title: t('msp.projects.detail.fallbackTitle', { defaultValue: 'Project Details' }) };
}

export default async function ProjectDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await getCurrentTenantProduct();

  return (
    <AIChatContextBoundary
      value={{
        pathname: `/msp/projects/${id}`,
        screen: {
          key: 'projects.detail',
          label: 'Project Details',
        },
        record: {
          type: 'project',
          id,
        },
      }}
    >
      {product === 'co_managed' && <CoManagedEffort target={{ kind: 'local_project', projectId: id }} />}
      <MspProjectPageClient params={params} />
    </AIChatContextBoundary>
  );
}
