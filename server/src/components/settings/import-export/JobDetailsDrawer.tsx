'use client';

import React, { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../../ui/Sheet';
import { Badge } from '../../ui/Badge';
import { Progress } from '../../ui/Progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/Tabs';
import { ScrollArea } from '../../ui/ScrollArea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/Card';
import { Clock, CheckCircle, XCircle, RefreshCw, FileText, Users, Calendar, User } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { getImportJob, type ImportJobSummary } from '../../../lib/actions/import-actions/importActions';

interface JobDetailsDrawerProps {
  jobId: string;
  open: boolean;
  onClose: () => void;
}

export default function JobDetailsDrawer({ jobId, open, onClose }: JobDetailsDrawerProps) {
  const [job, setJob] = useState<ImportJobSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    if (open && jobId) {
      fetchJobDetails();
      
      // Set up auto-refresh for running jobs
      const interval = setInterval(() => {
        if (autoRefresh && job?.state === 'RUNNING') {
          fetchJobDetails();
        }
      }, 2000); // Refresh every 2 seconds

      return () => clearInterval(interval);
    }
  }, [open, jobId, autoRefresh, job?.state]);

  const fetchJobDetails = async () => {
    try {
      const jobDetails = await getImportJob(jobId);
      if (jobDetails) {
        setJob(jobDetails);
        
        // Stop auto-refresh if job is complete
        if (jobDetails.state === 'SUCCESS' || jobDetails.state === 'ERROR') {
          setAutoRefresh(false);
        }
      }
    } catch (error) {
      console.error('Error fetching job details:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStateBadge = (state: string) => {
    switch (state) {
      case 'PENDING':
        return (
          <Badge variant="secondary" className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Pending
          </Badge>
        );
      case 'RUNNING':
        return (
          <Badge variant="default" className="flex items-center gap-1">
            <RefreshCw className="h-3 w-3 animate-spin" />
            Running
          </Badge>
        );
      case 'SUCCESS':
        return (
          <Badge variant="success" className="flex items-center gap-1">
            <CheckCircle className="h-3 w-3" />
            Success
          </Badge>
        );
      case 'ERROR':
        return (
          <Badge variant="destructive" className="flex items-center gap-1">
            <XCircle className="h-3 w-3" />
            Failed
          </Badge>
        );
      default:
        return null;
    }
  };

  const getProgress = () => {
    if (!job?.summary) return 0;
    const { totalCount, successCount = 0, errorCount = 0, skippedCount = 0 } = job.summary;
    if (!totalCount) return 0;
    const processed = successCount + errorCount + skippedCount;
    return Math.round((processed / totalCount) * 100);
  };

  return (
    <Sheet open={open} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[600px] sm:max-w-[600px]">
        <SheetHeader>
          <SheetTitle>Import Job Details</SheetTitle>
          <SheetDescription>
            View detailed information about this import job
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="py-8 text-center text-muted-foreground">
            Loading job details...
          </div>
        ) : job ? (
          <div className="mt-6 space-y-6">
            {/* Status Overview */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Status</span>
                {getStateBadge(job.state)}
              </div>

              {job.state === 'RUNNING' && job.summary && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Progress</span>
                    <span className="text-muted-foreground">{getProgress()}%</span>
                  </div>
                  <Progress value={getProgress()} className="h-2" />
                </div>
              )}
            </div>

            {/* Job Information */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Job Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Started
                  </span>
                  <span>
                    {format(new Date(job.started_at || job.created_at), 'PPp')}
                  </span>
                </div>
                
                {job.requested_by && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-2">
                      <User className="h-4 w-4" />
                      Requested by
                    </span>
                    <span>{job.requested_by}</span>
                  </div>
                )}

                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-2">
                    {job.artifact_type === 'company' ? <FileText className="h-4 w-4" /> : <Users className="h-4 w-4" />}
                    Import Type
                  </span>
                  <span className="capitalize">{job.artifact_type}s</span>
                </div>

                {job.duration && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      Duration
                    </span>
                    <span>{Math.round(job.duration / 1000)}s</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Summary Statistics */}
            {(job.state === 'SUCCESS' || job.state === 'ERROR') && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Import Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    {job.totalCount !== undefined && (
                      <div className="text-center">
                        <p className="text-2xl font-semibold">{job.totalCount}</p>
                        <p className="text-sm text-muted-foreground">Total Records</p>
                      </div>
                    )}
                    {job.successCount !== undefined && (
                      <div className="text-center">
                        <p className="text-2xl font-semibold text-green-600">{job.successCount}</p>
                        <p className="text-sm text-muted-foreground">Imported</p>
                      </div>
                    )}
                    {job.errorCount !== undefined && job.errorCount > 0 && (
                      <div className="text-center">
                        <p className="text-2xl font-semibold text-red-600">{job.errorCount}</p>
                        <p className="text-sm text-muted-foreground">Failed</p>
                      </div>
                    )}
                    {job.metadata?.skippedCount !== undefined && job.metadata.skippedCount > 0 && (
                      <div className="text-center">
                        <p className="text-2xl font-semibold text-yellow-600">{job.metadata.skippedCount}</p>
                        <p className="text-sm text-muted-foreground">Skipped</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Error Details */}
            {job.state === 'ERROR' && job.metadata?.error && (
              <Card className="border-red-200">
                <CardHeader>
                  <CardTitle className="text-base text-red-600">Error Details</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-red-600">{job.metadata.error}</p>
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          <div className="py-8 text-center text-muted-foreground">
            Job not found
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}