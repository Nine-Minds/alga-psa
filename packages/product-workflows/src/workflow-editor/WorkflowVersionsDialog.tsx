"use client";

import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@server/components/ui/Dialog";
import { Button } from "@server/components/ui/Button";
import { Badge } from "@server/components/ui/Badge";
import { History, Check, AlertCircle } from "lucide-react";
import { getWorkflowVersions, setActiveWorkflowVersion, WorkflowVersionData } from "@server/lib/actions/workflow-editor-actions";
import { toast } from "react-hot-toast";

interface WorkflowVersionsDialogProps {
  workflowId: string;
  currentVersion: string;
  onVersionChange?: () => void;
  isOpen: boolean; // Add isOpen prop
  onClose: () => void; // Add onClose prop
}

export default function WorkflowVersionsDialog({
  workflowId,
  currentVersion,
  onVersionChange,
  isOpen, // Destructure isOpen
  onClose // Destructure onClose
}: WorkflowVersionsDialogProps) {
  const [versions, setVersions] = useState<WorkflowVersionData[]>([]);
  const [loading, setLoading] = useState(false);
  const [activating, setActivating] = useState<string | null>(null);

  // Load versions when dialog opens
  useEffect(() => {
    if (isOpen) { // Use isOpen prop
      loadVersions();
    }
  }, [isOpen, workflowId]); // Depend on isOpen

  // Load workflow versions
  const loadVersions = async () => {
    setLoading(true);
    try {
      const versionData = await getWorkflowVersions(workflowId);
      setVersions(versionData);
    } catch (error) {
      console.error("Error loading workflow versions:", error);
      toast.error("Failed to load workflow versions");
    } finally {
      setLoading(false);
    }
  };

  // Set active version
  const handleSetActiveVersion = async (versionId: string) => {
    setActivating(versionId);
    try {
      const result = await setActiveWorkflowVersion(workflowId, versionId);
      if (result.success) {
        toast.success("Active version updated successfully");
        loadVersions();
        if (onVersionChange) {
          onVersionChange();
        }
      } else {
        toast.error("Failed to update active version");
      }
    } catch (error) {
      console.error("Error setting active version:", error);
      toast.error("An error occurred while updating the active version");
    } finally {
      setActivating(null);
    }
  };

  // Format date
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose}>
      <DialogTrigger asChild>
        <Button
          id="workflow-versions-button"
          variant="outline"
          className="flex items-center gap-2"
        >
          <History className="h-4 w-4" />
          Versions
          <Badge className="ml-1 bg-primary-100 text-primary-800">
            {currentVersion}
          </Badge>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Workflow Versions</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
            </div>
          ) : versions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <AlertCircle className="h-8 w-8 text-gray-400 mb-2" />
              <p className="text-gray-500">No versions found for this workflow</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Version
                    </th>
                    <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Created
                    </th>
                    <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th scope="col" className="relative px-4 py-2">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {versions.map((version) => (
                    <tr key={version.versionId} className="hover:bg-gray-50">
                      <td className="px-4 py-2 whitespace-nowrap text-sm font-medium text-gray-900">
                        {version.version}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">
                        {formatDate(version.createdAt)}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {version.isCurrent ? (
                          <Badge className="bg-green-100 text-green-800">
                            Active
                          </Badge>
                        ) : (
                          <Badge className="bg-gray-100 text-gray-800">
                            Inactive
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-right text-sm font-medium">
                        {!version.isCurrent && (
                          <Button
                            id={`activate-version-${version.versionId}`}
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSetActiveVersion(version.versionId)}
                            disabled={activating === version.versionId}
                            className="text-primary-600 hover:text-primary-900"
                          >
                            {activating === version.versionId ? (
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-500"></div>
                            ) : (
                              <>
                                <Check className="h-4 w-4 mr-1" />
                                Set Active
                              </>
                            )}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}