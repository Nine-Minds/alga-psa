import Link from 'next/link';
import type { IProject } from '@alga-psa/types';

export function projectNameMatchesSearch(project: IProject, search: string): boolean {
  const query = search.toLowerCase();
  return (project.project_name ?? '').toLowerCase().includes(query) ||
    (project.project_number ?? '').toLowerCase().includes(query);
}

export function compareProjectsByName(a: IProject, b: IProject): number {
  const aName = typeof a.project_name === 'string' ? a.project_name : '';
  const bName = typeof b.project_name === 'string' ? b.project_name : '';
  return aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' }) ||
    String(a.project_id ?? '').localeCompare(String(b.project_id ?? ''));
}

export function ProjectListProjectName({
  project,
  fallback,
}: {
  project: IProject;
  fallback: string;
}) {
  const name = project.project_name || fallback;
  return project.project_id
    ? <Link href={`/msp/projects/${project.project_id}`} className="text-blue-600 hover:text-blue-800 block whitespace-normal break-words">{name}</Link>
    : <span>{name}</span>;
}
