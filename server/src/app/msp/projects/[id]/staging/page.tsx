import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import ProjectStagingPage from '@alga-psa/projects/components/staging/ProjectStagingPage';

/**
 * Project staging (alga-2026-0002683 C6): reserved, staged and installed equipment, boxes, labels and
 * manifests. `?containerId=` opens a box: it is the canonical target of a scanned box label
 * (recordLinks `staging_container`). Authorization is enforced by the staging actions the page calls.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');
  return { title: t('msp.projects.detail.staging.title', { defaultValue: 'Project Staging' }) };
}

export default async function ProjectStagingRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ containerId?: string | string[] }>;
}) {
  const { id } = await params;
  const { containerId } = await searchParams;
  return <ProjectStagingPage projectId={id} containerId={typeof containerId === 'string' ? containerId : null} />;
}

export const dynamic = 'force-dynamic';
