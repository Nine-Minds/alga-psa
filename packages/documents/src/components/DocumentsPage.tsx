'use client';

import React, { useState, useEffect, useRef } from 'react';
import type { DocumentFilters as DocumentFilterType } from '@alga-psa/types';
import Documents from './Documents';
import { Card } from '@alga-psa/ui/components/Card';
import { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { getDistinctEntityTypes } from '../actions/documentActions';
import { getCurrentUser, getAllUsersBasic } from 'server/src/lib/actions/user-actions/userActions';
import type { IUser } from '@alga-psa/types';
import { toast } from 'react-hot-toast';
import DocumentFilters from './DocumentFilters';
import DocumentsPageSkeleton from './DocumentsPageSkeleton';
import { ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useUserPreference } from 'server/src/hooks/useUserPreference';

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
        console.error('Error during initialization:', error);
        if (mounted) {
          setError('Failed to initialize');
          toast.error('Failed to initialize');
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
    <div className="p-6">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-2xl font-semibold">
          <button
            onClick={() => handleFolderNavigate(null)}
            className="flex items-center gap-2 hover:text-blue-600 transition-colors"
          >
            <span>Documents</span>
          </button>
          {currentFolder && (
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
      </div>

      <div className="flex gap-6">
        {/* Collapsed Filters Button */}
        {isFiltersPaneCollapsed && (
          <div className="flex-shrink-0">
            <button
              onClick={() => setIsFiltersPaneCollapsed(false)}
              className="p-2 hover:bg-gray-100 rounded border border-gray-200 flex items-center gap-2"
              title="Show filters"
            >
              <Filter className="w-4 h-4" />
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Left Column - Filters */}
        {!isFiltersPaneCollapsed && (
          <div className="w-80 relative">
            <div className="absolute top-2 right-2 z-10">
              <button
                onClick={() => setIsFiltersPaneCollapsed(true)}
                className="p-1 hover:bg-gray-100 rounded"
                title="Collapse filters"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
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
              <div className="text-center py-4 text-red-500 bg-red-50 rounded-md">
                {displayError}
              </div>
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
    </div>
  );
}
