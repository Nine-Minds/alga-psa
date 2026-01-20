// @ts-nocheck
// TODO: invalidateCache property missing from hook return type
'use client';


import React, { createContext, useContext, useState, useCallback, ReactNode, useMemo } from 'react';
import { Activity, ActivityType } from "@alga-psa/types";
import { useDrawer } from "@alga-psa/ui";
import { ActivityDetailViewerDrawer } from "./ActivityDetailViewerDrawer";
import { useActivitiesCache } from "../../hooks/useActivitiesCache";

/**
 * Context for managing activity drawer state
 */
interface ActivityDrawerContextType {
  openActivityDrawer: (activity: Activity) => void;
  selectedActivityId: string | null;
}

const ActivityDrawerContext = createContext<ActivityDrawerContextType | undefined>(undefined);

/**
 * Provider component for managing activity drawer state
 * This component provides a method to open the drawer with a specific activity
 * and renders the ActivityDetailViewerDrawer when an activity is selected
 */
export function ActivityDrawerProvider({ children }: { children: ReactNode }) {
  const { openDrawer, closeDrawer } = useDrawer();
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
  const { invalidateCache } = useActivitiesCache();
  
  // Memoize the selectedActivityId to prevent unnecessary re-renders
  const selectedActivityId = useMemo(() =>
    selectedActivity ? selectedActivity.id : null
  , [selectedActivity]);
  
  // Create stable callback functions for drawer actions
  const handleClose = useCallback(() => {
    setSelectedActivity(null);
    closeDrawer();
  }, [closeDrawer]);
  
  const handleActionComplete = useCallback(() => {
    // Handle action completion (e.g., refresh data)
    if (selectedActivity) {
      // Invalidate cache for this activity type to ensure fresh data
      invalidateCache({ activityType: selectedActivity.type });
    }
    setSelectedActivity(null);
    closeDrawer();
  }, [closeDrawer, invalidateCache, selectedActivity]);
  
  const openActivityDrawer = useCallback((activity: Activity) => {
    
    setSelectedActivity(activity);
    openDrawer(
      <ActivityDetailViewerDrawer
        activityType={activity.type}
        activityId={activity.id}
        onClose={handleClose}
        onActionComplete={handleActionComplete}
      />
    );
  }, [openDrawer, handleClose, handleActionComplete]);
  
  // Memoize the context value to prevent unnecessary re-renders
  const contextValue = useMemo(() => ({
    openActivityDrawer,
    selectedActivityId
  }), [openActivityDrawer, selectedActivityId]);
  
  return (
    <ActivityDrawerContext value={contextValue}>
      {children}
    </ActivityDrawerContext>
  );
}

/**
 * Hook for accessing the activity drawer context
 * This hook must be used within an ActivityDrawerProvider
 */
export const useActivityDrawer = () => {
  const context = useContext(ActivityDrawerContext);
  if (!context) {
    throw new Error('useActivityDrawer must be used within an ActivityDrawerProvider');
  }
  return context;
};
