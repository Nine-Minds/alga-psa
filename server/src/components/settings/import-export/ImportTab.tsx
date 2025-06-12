'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Alert, AlertDescription } from '../../ui/Alert';
import { Badge } from '../../ui/Badge';
import { RefreshCw, Upload, History, AlertCircle } from 'lucide-react';
import ImportSourceCard from './ImportSourceCard';
import JobHistoryTable from './JobHistoryTable';
import { useToast } from '../../../hooks/use-toast';
import { 
  getImportSources, 
  createImportJob, 
  getImportJobs,
  type ImportSource as ImportSourceType,
  type ImportJob as ImportJobType
} from '../../../lib/actions/import-actions/importActions';

export default function ImportTab() {
  const [sources, setSources] = useState<ImportSourceType[]>([]);
  const [jobs, setJobs] = useState<ImportJobType[]>([]);
  const [loadingSources, setLoadingSources] = useState(true);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const { toast } = useToast();

  // Fetch available import sources
  useEffect(() => {
    fetchSources();
    fetchJobs();
  }, []);

  const fetchSources = async () => {
    try {
      const sources = await getImportSources();
      setSources(sources);
    } catch (error) {
      console.error('Error fetching sources:', error);
      toast({
        title: 'Error',
        description: 'Failed to load import sources',
        variant: 'destructive',
      });
    } finally {
      setLoadingSources(false);
    }
  };

  const fetchJobs = async () => {
    setLoadingJobs(true);
    try {
      const { jobs } = await getImportJobs({ limit: 10 });
      setJobs(jobs);
    } catch (error) {
      console.error('Error fetching jobs:', error);
      toast({
        title: 'Error',
        description: 'Failed to load import history',
        variant: 'destructive',
      });
    } finally {
      setLoadingJobs(false);
    }
  };

  const handleImportStart = async (sourceId: string, artifactType: 'company' | 'contact') => {
    try {
      const result = await createImportJob(sourceId, artifactType);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to start import');
      }
      
      toast({
        title: 'Import Started',
        description: `Import job ${result.jobId} has been created and will start processing shortly.`,
      });

      // Refresh job history
      fetchJobs();
    } catch (error: any) {
      console.error('Error starting import:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to start import job',
        variant: 'destructive',
      });
    }
  };

  const runningJobs = jobs.filter(job => job.state === 'RUNNING').length;

  return (
    <div className="space-y-6">
      {/* Sources Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Import Sources</CardTitle>
              <CardDescription>
                Connect to external systems to import your data
              </CardDescription>
            </div>
            <Button
              id="refresh-sources-button"
              variant="outline"
              size="sm"
              onClick={fetchSources}
              disabled={loadingSources}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {runningJobs > 0 && (
            <Alert className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {runningJobs} import job{runningJobs > 1 ? 's' : ''} currently running.
                New imports will be queued.
              </AlertDescription>
            </Alert>
          )}
          
          {loadingSources ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading import sources...
            </div>
          ) : sources.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No import sources available
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {sources.map((source) => (
                <ImportSourceCard
                  key={source.sourceId}
                  source={source}
                  onImport={handleImportStart}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* History Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Import History</CardTitle>
              <CardDescription>
                Recent import jobs and their status
              </CardDescription>
            </div>
            <Button
              id="refresh-jobs-button"
              variant="outline"
              size="sm"
              onClick={fetchJobs}
              disabled={loadingJobs}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <JobHistoryTable
            jobs={jobs}
            loading={loadingJobs}
            onRefresh={fetchJobs}
          />
        </CardContent>
      </Card>
    </div>
  );
}