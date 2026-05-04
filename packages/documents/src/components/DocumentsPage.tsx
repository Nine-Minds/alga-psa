'use client';

import React, { useState, useEffect, useRef } from 'react';
import type { DocumentFilters as DocumentFilterType } from '@alga-psa/types';
import Documents from './Documents';
import { Card } from '@alga-psa/ui/components/Card';
import { CollapseToggleButton } from '@alga-psa/ui/components/CollapseToggleButton';
import { UnsavedChangesProvider } from '@alga-psa/ui/context';
import { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { getDistinctEntityTypes } from '../actions/documentActions';
import { getCurrentUser, getAllUsersBasic } from '@alga-psa/user-composition/actions';
import type { IUser } from '@alga-psa/types';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import DocumentFilters from './DocumentFilters';
import DocumentsPageSkeleton from './DocumentsPageSkeleton';
import { DocumentTemplatesSettings } from './settings';
import { ChevronRight, Settings2 } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useSearchParams, useRouter } from 'next/navigation';
import { useUserPreference } from '@alga-psa/user-composition/hooks';

const FILTERS_PANE_COLLAPSED_SETTING = 'documents_filters_pane_collapsed';

export default function DocumentsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const currentFolder = searchParams?.get('folder') ?? null;

  // Use user preference for filters pane collapsed state
  const {
    value: isFiltersPaneCollapsed,
    setValue: setIsFiltersPaneCollapsed
  } = useUserPreference<boolean>(
    FILTERS_PANE_COLLAPSED_SETTING,
    {
      defaultValue: false,
      localStorageKey: FILTERS_PANE_COLLAPSED_SETTING,
      debounceMs: 300
    }
  );

  const [showDefaultFolders, setShowDefaultFolders] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [allUsersData, setAllUsersData] = useState<IUser[]>([]);
  const [entityTypeOptions, setEntityTypeOptions] = useState<SelectOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Use a ref to track if this is the first render to avoid unnecessary filter updates
  const isFirstRender = useRef(true);

  const [filterInputs, setFilterInputs] = useState<DocumentFilterType>({
    entityType: '',
    searchTerm: '',
    uploadedBy: '',
    updated_at_start: '',
    updated_at_end: '',
    sortBy: 'updated_at',
    sortOrder: 'desc',
    showAllDocuments: false,
    folder_path: currentFolder || undefined
  });

  // Documents.tsx handles its own fetching in folder mode - no need for useDocuments here
  // This avoids duplicate fetching since Documents.tsx calls getDocumentsByFolder internally

  const capitalizeFirstLetter = (string: string) => {
    return string.charAt(0).toUpperCase() + string.slice(1);
  };

  const handleFiltersChange = (newFilters: DocumentFilterType) => {
    setFilterInputs(newFilters);
  };

  const handleClearFilters = () => {
    const clearedFilters: DocumentFilterType = {
      entityType: '',
      searchTerm: '',
      uploadedBy: '',
      updated_at_start: '',
      updated_at_end: '',
      sortBy: 'updated_at',
      sortOrder: 'desc',
      showAllDocuments: false,
      folder_path: currentFolder || undefined
    };
    setFilterInputs(clearedFilters);
  };

  // Documents.tsx handles refresh internally via its own refreshDocuments callback

  const handleFolderNavigate = (folderPath: string | null, clearShowAll: boolean = true) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (folderPath) {
      params.set('folder', folderPath);
    } else {
      params.delete('folder');
    }
    const newUrl = params.toString() ? `?${params.toString()}` : window.location.pathname;
    router.replace(newUrl);

    // Update filters immediately for responsive UI
    if (clearShowAll) {
      setFilterInputs(prev => ({
        ...prev,
        showAllDocuments: false,
        folder_path: folderPath || undefined
      }));
    }
  };

  const handleShowAllDocuments = () => {
    // Navigate to root folder (no folder parameter)
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.delete('folder');
    const newUrl = window.location.pathname;
    router.replace(newUrl);

    // Set showAllDocuments flag to display all documents without folder hierarchy
    setFilterInputs({
      ...filterInputs,
      showAllDocuments: true,
      folder_path: undefined
    });
  };


  // Update folder_path and clear showAllDocuments flag when folder changes
  // Skip the first render since initial state already has the correct folder_path
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    setFilterInputs(prev => {
      // Only update if folder actually changed to avoid unnecessary re-renders
      const newFolderPath = currentFolder || undefined;
      if (prev.folder_path === newFolderPath) {
        return prev;
      }
      return {
        ...prev,
        folder_path: newFolderPath,
        showAllDocuments: currentFolder ? false : prev.showAllDocuments
      };
    });
  }, [currentFolder]);

  useEffect(() => {
    let mounted = true;

    const initialize = async () => {
      if (initialized) return;

      try {
        setError(null);

        const [user, allUsersResponse, dbEntityTypes] = await Promise.all([
          getCurrentUser(),
          getAllUsersBasic(),
          getDistinctEntityTypes()
        ]);

        if (!mounted) return;

        if (user) {
          setCurrentUserId(user.user_id);
        } else {
          setError('No current user found');
          toast.error('No current user found');
        }

        if (allUsersResponse && Array.isArray(allUsersResponse)) {
          setAllUsersData(allUsersResponse);
        } else {
          console.error('Failed to fetch users for filter or response was not an array:', allUsersResponse);
          setAllUsersData([]);
        }

        if (dbEntityTypes && Array.isArray(dbEntityTypes)) {
          const options = dbEntityTypes.map(et => ({
            value: et,
            label: capitalizeFirstLetter(et)
          }));
          setEntityTypeOptions([
            { value: 'all_entities', label: 'All Entity Types' },
            ...options
          ]);
        } else {
          console.error('Failed to fetch entity types or response was not an array:', dbEntityTypes);
          setEntityTypeOptions([{ value: 'all_entities', label: 'All Entity Types' }]);
        }

        setInitialized(true);
      } catch (error) {
        if (mounted) {
          setError('Failed to initialize');
          handleError(error, 'Failed to initialize');
        }
      }
    };

    initialize();

    return () => {
      mounted = false;
    };
  }, []); // Run once on mount


  if (!initialized) {
    return <DocumentsPageSkeleton />;
  }

  // Only use local error state - Documents.tsx handles its own error display in folder mode
  const displayError = error;

  return (
    <UnsavedChangesProvider>
    <div className="p-6">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-2xl font-semibold">
            <button
              onClick={() => { handleFolderNavigate(null); setShowDefaultFolders(false); }}
              className="flex items-center gap-2 hover:text-blue-600 transition-colors"
            >
              <span>Documents</span>
            </button>
            {showDefaultFolders && (
              <>
                <ChevronRight className="w-5 h-5 text-gray-400" />
                <span className="text-lg font-medium text-gray-600 dark:text-[rgb(var(--color-text-400))]">Default Folders</span>
              </>
            )}
            {!showDefaultFolders && currentFolder && (
              <>
                {currentFolder.split('/').filter(p => p).map((part, index, parts) => {
                  const path = '/' + parts.slice(0, index + 1).join('/');
                  return (
                    <React.Fragment key={path}>
                      <ChevronRight className="w-5 h-5 text-gray-400" />
                      <button
                        onClick={() => handleFolderNavigate(path)}
                        className="hover:text-blue-600 transition-colors"
                      >
                        {part}
                      </button>
                    </React.Fragment>
                  );
                })}
              </>
            )}
          </div>
          <button
            onClick={() => setShowDefaultFolders(prev => !prev)}
            className={`p-2 rounded-md border transition-colors ${
              showDefaultFolders
                ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300'
                : 'border-gray-200 dark:border-[rgb(var(--color-border-200))] text-gray-500 dark:text-[rgb(var(--color-text-400))] hover:bg-gray-50 dark:hover:bg-[rgb(var(--color-border-50))]'
            }`}
            title="Configure default folders"
          >
            <Settings2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      {showDefaultFolders ? (
        <Card className="p-6">
          <DocumentTemplatesSettings />
        </Card>
      ) : (
        <div className="flex gap-6">
          {/* Collapsed Filters Button */}
          {isFiltersPaneCollapsed && (
            <div className="flex-shrink-0">
              <CollapseToggleButton
                id="documents-show-filters-button"
                isCollapsed={true}
                collapsedLabel="Show filters"
                expandedLabel="Collapse filters"
                expandDirection="right"
                onClick={() => setIsFiltersPaneCollapsed(false)}
              />
            </div>
          )}

          {/* Left Column - Filters */}
          {!isFiltersPaneCollapsed && (
            <div className="w-80 relative">
              <div className="absolute top-2 right-2 z-10">
                <CollapseToggleButton
                  id="documents-collapse-filters-button"
                  isCollapsed={false}
                  collapsedLabel="Show filters"
                  expandedLabel="Collapse filters"
                  expandDirection="right"
                  onClick={() => setIsFiltersPaneCollapsed(true)}
                />
              </div>
              <DocumentFilters
                filters={filterInputs}
                onFiltersChange={handleFiltersChange}
                onClearFilters={handleClearFilters}
                entityTypeOptions={entityTypeOptions}
                allUsersData={allUsersData}
                onShowAllDocuments={handleShowAllDocuments}
                showAllDocumentsButton={true}
              />
            </div>
          )}

          {/* Right Column - Documents */}
          <div className="flex-1">
            <Card className="p-4">
              {displayError ? (
                <Alert variant="destructive">
                  <AlertDescription>{displayError}</AlertDescription>
                </Alert>
              ) : (
                <Documents
                  id='documents'
                  documents={[]}
                  gridColumns={3}
                  userId={currentUserId}
                  searchTermFromParent={filterInputs.searchTerm}
                  filters={filterInputs}
                />
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
    </UnsavedChangesProvider>
  );
}
