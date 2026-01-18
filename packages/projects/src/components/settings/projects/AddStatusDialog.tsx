'use client';

import { useState, useEffect } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import {
  getTenantProjectStatuses,
  addStatusToProject
} from '@alga-psa/projects/actions/projectTaskStatusActions';
import type { IStatus } from '@alga-psa/types';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';

interface AddStatusDialogProps {
  projectId: string;
  onClose: () => void;
  onAdded: () => void;
}

export function AddStatusDialog({ projectId, onClose, onAdded }: AddStatusDialogProps) {
  const [tenantStatuses, setTenantStatuses] = useState<IStatus[]>([]);
  const [selectedStatusId, setSelectedStatusId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadTenantStatuses();
  }, []);

  async function loadTenantStatuses() {
    try {
      const data = await getTenantProjectStatuses();
      setTenantStatuses(data);
    } catch (error) {
      console.error('Failed to load tenant statuses:', error);
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      // Add existing status from library to project
      await addStatusToProject(projectId, {
        status_id: selectedStatusId
      });

      onAdded();
      onClose();
    } catch (error) {
      console.error('Failed to add status:', error);
      alert('Failed to add status. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const statusOptions = tenantStatuses.map(status => ({
    value: status.status_id,
    label: `${status.name}${status.is_closed ? ' (Closed)' : ''}`
  }));

  return (
    <Dialog
      isOpen={true}
      onClose={onClose}
      title="Add Status from Library"
      id="add-status-dialog"
    >
      <div className="space-y-4 p-4">
        {/* Library selection only */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Select from Status Library
          </label>
          {statusOptions.length > 0 ? (
            <>
              <CustomSelect
                value={selectedStatusId}
                onValueChange={setSelectedStatusId}
                options={statusOptions}
                placeholder="Choose a status"
                id="status-select"
              />
              <p className="text-xs text-gray-500 mt-2">
                Select a status from your tenant's status library to add to this project.
              </p>
            </>
          ) : (
            <div className="text-sm text-gray-500 p-4 bg-gray-50 rounded-lg">
              <p className="font-medium mb-2">No statuses available</p>
              <p>Create statuses in Settings → Projects → Statuses first.</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose} id="cancel-button">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !selectedStatusId}
            id="submit-status-button"
          >
            {submitting ? 'Adding...' : 'Add Status'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
