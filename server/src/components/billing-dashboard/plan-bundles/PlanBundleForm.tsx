'use client';

import React, { useState } from 'react';
import { Card, Box } from '@radix-ui/themes';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle, Save } from 'lucide-react';
import { IPlanBundle } from 'server/src/interfaces/planBundle.interfaces';
import { updatePlanBundle } from 'server/src/lib/actions/planBundleActions';
import { useTenant } from 'server/src/components/TenantProvider';

interface PlanBundleFormProps {
  bundle: IPlanBundle;
  onBundleUpdated: () => void;
}

const PlanBundleForm: React.FC<PlanBundleFormProps> = ({ bundle, onBundleUpdated }) => {
  const [bundleName, setBundleName] = useState(bundle.bundle_name);
  const [description, setDescription] = useState(bundle.description || '');
  const [isActive, setIsActive] = useState<boolean>(bundle.is_active);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const tenant = useTenant()!;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!bundleName.trim()) {
      setError('Bundle name is required');
      return;
    }
    
    setIsSaving(true);
    setError(null);
    
    try {
      await updatePlanBundle(bundle.bundle_id, {
        bundle_name: bundleName,
        description: description || undefined,
        is_active: isActive,
        tenant
      });
      
      onBundleUpdated();
    } catch (error) {
      console.error('Error updating bundle:', error);
      setError('Failed to update bundle');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card size="2">
      <Box p="4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <h3 className="text-lg font-medium mb-4">Bundle Details</h3>
          
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          
          <div>
            <Label htmlFor="bundle-name">Bundle Name</Label>
            <Input
              id="bundle-name"
              value={bundleName}
              onChange={(e) => setBundleName(e.target.value)}
              placeholder="Enter bundle name"
              required
            />
          </div>
          
          <div>
            <Label htmlFor="description">Description</Label>
            <TextArea
              id="description"
              value={description}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
              placeholder="Enter bundle description"
              className="min-h-[100px]"
            />
          </div>
          
          <div className="flex items-center space-x-2">
            <Checkbox
              id="is-active"
              checked={isActive}
              onChange={(checked) => setIsActive(!!checked)}
            />
            <Label htmlFor="is-active" className="cursor-pointer">Active</Label>
          </div>
          
          <div className="flex justify-end">
            <Button
              id="save-bundle-details-btn"
              type="submit"
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
              {!isSaving && <Save className="ml-2 h-4 w-4" />}
            </Button>
          </div>
        </form>
      </Box>
    </Card>
  );
};

export default PlanBundleForm;