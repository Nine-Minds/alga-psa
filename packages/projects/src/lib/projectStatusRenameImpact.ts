/**
 * Which project columns actually follow a rename of one Task Status Library
 * status, and which quietly keep the name they show today.
 *
 * Boards label a column with COALESCE(custom_name, statuses.name,
 * standard_statuses.name), so only a column linked straight to the renamed
 * status with no custom_name re-reads the new name. Two other shapes render the
 * identical label today and never move:
 *   - linked to this status but pinned to a custom_name;
 *   - not linked to this status at all — older projects seeded against
 *     standard_statuses (custom_name pinned, status_id null), or a duplicate
 *     library status that happens to carry the same name.
 * That second shape is why two projects in one tenant can show different names
 * for the same concept after a single rename, so it has to be named, not just
 * counted.
 */

export type ProjectStatusRenameImpactRow = {
  status_id: string | null;
  custom_name: string | null;
  project_id: string;
  project_name: string | null;
};

export type ProjectStatusRenameImpactBucket = {
  columns: number;
  projects: string[];
};

export type ProjectStatusRenameImpact = {
  statusName: string;
  following: ProjectStatusRenameImpactBucket;
  keeping: ProjectStatusRenameImpactBucket;
};

/**
 * `rows` must be the match set: every column linked to `statusId` plus every
 * column whose rendered label already equals `statusName` (the caller's SQL
 * compares those trimmed and case-insensitively).
 */
export function bucketProjectStatusRenameImpact(
  rows: ProjectStatusRenameImpactRow[],
  statusId: string,
  statusName: string
): ProjectStatusRenameImpact {
  const following = { columns: 0, projects: new Set<string>() };
  const keeping = { columns: 0, projects: new Set<string>() };

  for (const row of rows) {
    const follows = row.status_id === statusId && row.custom_name === null;
    const bucket = follows ? following : keeping;
    bucket.columns += 1;
    bucket.projects.add(row.project_name || `Unknown project (${row.project_id})`);
  }

  const toBucket = (bucket: { columns: number; projects: Set<string> }): ProjectStatusRenameImpactBucket => ({
    columns: bucket.columns,
    projects: [...bucket.projects].sort((a, b) => a.localeCompare(b)),
  });

  return {
    statusName,
    following: toBucket(following),
    keeping: toBucket(keeping),
  };
}
