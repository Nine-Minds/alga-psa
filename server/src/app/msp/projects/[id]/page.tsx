import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { getProject, getProjectSurfaceAccess } from '@alga-psa/projects/actions/projectActions';
import { OPEN_PROJECT_SURFACE } from '@alga-psa/projects/lib/projectSurface';
import { getCurrentProductPrincipal } from '@/lib/productAccess';
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
  // What the server closes on this screen for a restricted principal (a seat technician). An ordinary user is not a
  // restricted principal, so the screen is the native one and nothing is read: the principal is already loaded for
  // the layout.
  const principal = await getCurrentProductPrincipal();
  const surface = principal.surfaceKind ? await getProjectSurfaceAccess() : OPEN_PROJECT_SURFACE;

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
      <MspProjectPageClient params={params} surface={surface} />
    </AIChatContextBoundary>
  );
}
