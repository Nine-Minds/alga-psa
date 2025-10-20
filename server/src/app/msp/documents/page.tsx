"use client";

import React, { useState, useEffect } from 'react';
import type { DocumentFilters as DocumentFilterType } from 'server/src/interfaces/document.interface';
import Documents from 'server/src/components/documents/Documents';
import { Card } from 'server/src/components/ui/Card';
import { SelectOption } from 'server/src/components/ui/CustomSelect';
import { getDistinctEntityTypes } from 'server/src/lib/actions/document-actions/documentActions';
import { getCurrentUser, getAllUsers } from 'server/src/lib/actions/user-actions/userActions';
import { IUserWithRoles } from 'server/src/interfaces/index';
import { toast } from 'react-hot-toast';
import DocumentsPagination from 'server/src/components/documents/DocumentsPagination';
import DocumentFilters from 'server/src/components/documents/DocumentFilters';
import DocumentsPageSkeleton from 'server/src/components/documents/DocumentsPageSkeleton';
import { useDocuments } from 'server/src/hooks/useDocuments';
import { ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useUserPreference } from 'server/src/hooks/useUserPreference';

const FILTERS_PANE_COLLAPSED_SETTING = 'documents_filters_pane_collapsed';

export default function DocumentsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const currentFolder = searchParams.get('folder');

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
  const [allUsersData, setAllUsersData] = useState<IUserWithRoles[]>([]);
  const [entityTypeOptions, setEntityTypeOptions] = useState<SelectOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  
  const [filterInputs, setFilterInputs] = useState<DocumentFilterType>({
    entityType: '',
    searchTerm: '',
    uploadedBy: '',
    updated_at_start: '',
    updated_at_end: '',
    sortBy: 'updated_at',
    sortOrder: 'desc'
  });

  const pageSize = 15;
  
  const {
    documents,
    totalCount,
    isLoading,
    error: documentsError,
    refetch: refetchDocuments
  } = useDocuments(
    initialized ? filterInputs : {},
    currentPage,
    pageSize
  );
  
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const capitalizeFirstLetter = (string: string) => {
    return string.charAt(0).toUpperCase() + string.slice(1);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleFiltersChange = (newFilters: DocumentFilterType) => {
    setFilterInputs(newFilters);
    setCurrentPage(1); // Reset to first page when filters change
  };

  const handleClearFilters = () => {
    const clearedFilters: DocumentFilterType = {
      entityType: '',
      searchTerm: '',
      uploadedBy: '',
      updated_at_start: '',
      updated_at_end: '',
      sortBy: 'updated_at',
      sortOrder: 'desc'
    };
    setFilterInputs(clearedFilters);
    setCurrentPage(1); // Reset to first page when filters are cleared
  };

  const handleDocumentUpdate = async () => {
    await refetchDocuments();
  };

  const handleFolderNavigate = (folderPath: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (folderPath) {
      params.set('folder', folderPath);
    } else {
      params.delete('folder');
    }
    const newUrl = params.toString() ? `?${params.toString()}` : window.location.pathname;
    router.replace(newUrl);
  };


  useEffect(() => {
    let mounted = true;
    
    const initialize = async () => {
      if (initialized) return;

      try {
        setError(null);

        const [user, allUsersResponse, dbEntityTypes] = await Promise.all([
          getCurrentUser(),
          getAllUsers(),
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

  const displayError = error || documentsError;

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
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded border border-gray-200 flex items-center gap-2"
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
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
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
                documents={documents}
                gridColumns={3}
                userId={currentUserId}
                isLoading={isLoading}
                onDocumentCreated={handleDocumentUpdate}
                searchTermFromParent={filterInputs.searchTerm}
              />
            )}
            
            {/* Pagination controls */}
            {!isLoading && documents.length > 0 && totalPages > 1 && (
              <div className="mt-4 flex justify-center">
                <DocumentsPagination
                  id="main-documents-pagination"
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={handlePageChange}
                />
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
