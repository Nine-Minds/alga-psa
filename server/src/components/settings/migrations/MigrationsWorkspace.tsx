'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import MigrationJobsHome from './MigrationJobsHome';
import MigrationJobDetail from './MigrationJobDetail';

/**
 * Top-level AMP migration workspace: the jobs home when no job is selected,
 * otherwise the selected job's lifecycle detail. Selection lives in the
 * `migrationJobId` URL param so job links survive refresh and sharing.
 */
const MigrationsWorkspace = (): React.JSX.Element => {
  const searchParams = useSearchParams();
  const jobIdParam = searchParams?.get('migrationJobId') ?? null;

  const [selectedJobId, setSelectedJobId] = useState<string | null>(jobIdParam);

  useEffect(() => {
    if (jobIdParam !== selectedJobId) {
      setSelectedJobId(jobIdParam);
    }
    // Only resync from the URL when the URL itself changes (back/forward, links).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobIdParam]);

  const updateUrl = useCallback((migrationJobId: string | null) => {
    const params = new URLSearchParams(window.location.search);
    if (migrationJobId) {
      params.set('migrationJobId', migrationJobId);
    } else {
      params.delete('migrationJobId');
    }
    const query = params.toString();
    const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.pushState({}, '', nextUrl);
  }, []);

  const handleSelectJob = useCallback(
    (migrationJobId: string) => {
      setSelectedJobId(migrationJobId);
      updateUrl(migrationJobId);
    },
    [updateUrl]
  );

  const handleBackToJobs = useCallback(() => {
    setSelectedJobId(null);
    updateUrl(null);
  }, [updateUrl]);

  if (selectedJobId) {
    return <MigrationJobDetail migrationJobId={selectedJobId} onBack={handleBackToJobs} />;
  }

  return <MigrationJobsHome onSelectJob={handleSelectJob} />;
};

export default MigrationsWorkspace;
