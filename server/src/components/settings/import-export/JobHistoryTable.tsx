'use client';

import React, { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/Table';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Eye, RefreshCw, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import JobDetailsDrawer from './JobDetailsDrawer';
import { type ImportJob } from '../../../lib/actions/import-actions/importActions';

interface JobHistoryTableProps {
  jobs: ImportJob[];
  loading: boolean;
  onRefresh: () => void;
}

export default function JobHistoryTable({ jobs, loading, onRefresh }: JobHistoryTableProps) {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const getStateBadge = (state: ImportJob['state']) => {
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
    }
  };

  const getSourceName = (sourceId: string) => {
    switch (sourceId) {
      case 'qbo':
        return 'QuickBooks Online';
      case 'csv':
        return 'CSV File';
      default:
        return sourceId;
    }
  };

  const getArtifactLabel = (artifactType: 'company' | 'contact') => {
    switch (artifactType) {
      case 'company':
        return 'Companies';
      case 'contact':
        return 'Contacts';
      default:
        return artifactType;
    }
  };

  if (loading && jobs.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Loading import history...
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>No import jobs yet</p>
        <p className="text-sm mt-1">Start an import from the sources above</p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Summary</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => (
              <TableRow key={job.job_id}>
                <TableCell>{getStateBadge(job.state)}</TableCell>
                <TableCell>{getSourceName(job.source_id)}</TableCell>
                <TableCell>{getArtifactLabel(job.artifact_type)}</TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">
                    {formatDistanceToNow(new Date(job.started_at || job.created_at), { addSuffix: true })}
                  </span>
                </TableCell>
                <TableCell>
                  {job.metadata ? (
                    <div className="text-sm">
                      {job.state === 'SUCCESS' && job.metadata.successCount !== undefined && (
                        <span className="text-green-600">
                          {job.metadata.successCount} imported
                        </span>
                      )}
                      {job.state === 'ERROR' && job.metadata.error && (
                        <span className="text-red-600 truncate max-w-[200px] inline-block">
                          {job.metadata.error}
                        </span>
                      )}
                      {job.state === 'RUNNING' && job.metadata.processedCount !== undefined && (
                        <span>
                          {job.metadata.processedCount} processed
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedJobId(job.job_id)}
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    Details
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {selectedJobId && (
        <JobDetailsDrawer
          jobId={selectedJobId}
          open={!!selectedJobId}
          onClose={() => setSelectedJobId(null)}
        />
      )}
    </>
  );
}