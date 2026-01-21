'use client';

import { Suspense, useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { CustomTabs } from 'server/src/components/ui/CustomTabs';
import { SlaPolicyList, SlaPolicyForm, SlaPauseSettings, BusinessHoursSettings } from '@alga-psa/sla/components';
import { ISlaPolicy } from '@alga-psa/sla/types';
import { Button } from 'server/src/components/ui/Button';
import { ArrowLeft } from 'lucide-react';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';

// Map URL slugs to tab labels
const TAB_SLUG_TO_LABEL: Record<string, string> = {
  'policies': 'Policies',
  'business-hours': 'Business Hours',
  'pause-rules': 'Pause Rules',
};

// Map tab labels to URL slugs
const TAB_LABEL_TO_SLUG: Record<string, string> = {
  'Policies': 'policies',
  'Business Hours': 'business-hours',
  'Pause Rules': 'pause-rules',
};

const DEFAULT_TAB = 'Policies';

export default function SlaSettingsPage() {
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab');

  // State for policy form management
  const [editingPolicy, setEditingPolicy] = useState<ISlaPolicy | null>(null);
  const [isAddingPolicy, setIsAddingPolicy] = useState(false);

  // Determine initial tab from URL
  const getInitialTab = (): string => {
    if (!tabParam) return DEFAULT_TAB;
    return TAB_SLUG_TO_LABEL[tabParam.toLowerCase()] || DEFAULT_TAB;
  };

  const [currentTab, setCurrentTab] = useState<string>(getInitialTab());

  // Sync state when URL changes
  useEffect(() => {
    const newTab = getInitialTab();
    if (newTab !== currentTab) {
      setCurrentTab(newTab);
      // Reset form state when switching tabs
      setEditingPolicy(null);
      setIsAddingPolicy(false);
    }
  }, [tabParam]);

  // Update URL when tab changes
  const updateURL = useCallback((tabLabel: string) => {
    const currentSearchParams = new URLSearchParams(window.location.search);
    const urlSlug = TAB_LABEL_TO_SLUG[tabLabel];

    if (urlSlug && tabLabel !== DEFAULT_TAB) {
      currentSearchParams.set('tab', urlSlug);
    } else {
      currentSearchParams.delete('tab');
    }

    const newUrl = currentSearchParams.toString()
      ? `${window.location.pathname}?${currentSearchParams.toString()}`
      : window.location.pathname;

    window.history.pushState({}, '', newUrl);
  }, []);

  // Handle tab change
  const handleTabChange = useCallback((newTab: string) => {
    if (newTab === currentTab) return;
    setCurrentTab(newTab);
    updateURL(newTab);
    // Reset form state when switching tabs
    setEditingPolicy(null);
    setIsAddingPolicy(false);
  }, [currentTab, updateURL]);

  // Policy form handlers
  const handleAddPolicy = useCallback(() => {
    setEditingPolicy(null);
    setIsAddingPolicy(true);
  }, []);

  const handleEditPolicy = useCallback((policy: ISlaPolicy) => {
    setEditingPolicy(policy);
    setIsAddingPolicy(false);
  }, []);

  const handleFormSave = useCallback(() => {
    setEditingPolicy(null);
    setIsAddingPolicy(false);
  }, []);

  const handleFormCancel = useCallback(() => {
    setEditingPolicy(null);
    setIsAddingPolicy(false);
  }, []);

  // Determine if we're showing the form or the list for the Policies tab
  const showPolicyForm = isAddingPolicy || editingPolicy !== null;

  // Render the policies tab content based on state
  const renderPoliciesContent = () => {
    if (showPolicyForm) {
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Button
              id="back-to-policies-list"
              variant="ghost"
              size="sm"
              onClick={handleFormCancel}
              className="gap-1"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Policies
            </Button>
            <h2 className="text-lg font-medium">
              {editingPolicy ? 'Edit SLA Policy' : 'Create SLA Policy'}
            </h2>
          </div>
          <SlaPolicyForm
            policyId={editingPolicy?.sla_policy_id}
            onSave={handleFormSave}
            onCancel={handleFormCancel}
          />
        </div>
      );
    }

    return (
      <Suspense fallback={
        <div className="flex items-center justify-center py-8">
          <LoadingIndicator
            layout="stacked"
            text="Loading SLA policies..."
            spinnerProps={{ size: 'md' }}
          />
        </div>
      }>
        <SlaPolicyList
          onAddPolicy={handleAddPolicy}
          onEditPolicy={handleEditPolicy}
        />
      </Suspense>
    );
  };

  const tabs = [
    {
      label: 'Policies',
      content: renderPoliciesContent(),
    },
    {
      label: 'Business Hours',
      content: (
        <Suspense fallback={
          <div className="flex items-center justify-center py-8">
            <LoadingIndicator
              layout="stacked"
              text="Loading business hours..."
              spinnerProps={{ size: 'md' }}
            />
          </div>
        }>
          <BusinessHoursSettings />
        </Suspense>
      ),
    },
    {
      label: 'Pause Rules',
      content: (
        <Suspense fallback={
          <div className="flex items-center justify-center py-8">
            <LoadingIndicator
              layout="stacked"
              text="Loading pause settings..."
              spinnerProps={{ size: 'md' }}
            />
          </div>
        }>
          <SlaPauseSettings />
        </Suspense>
      ),
    },
  ];

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">SLA Settings</h1>
        <p className="text-gray-600 text-sm mt-1">
          Configure service level agreement policies, business hours, and pause rules
        </p>
      </div>
      <CustomTabs
        tabs={tabs}
        value={currentTab}
        onTabChange={handleTabChange}
        idPrefix="sla-settings"
      />
    </div>
  );
}
