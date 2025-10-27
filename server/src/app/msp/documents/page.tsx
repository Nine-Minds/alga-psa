"use client";

import { useState, useEffect } from 'react';
import type { DocumentFilters as DocumentFilterType } from 'server/src/interfaces/document.interface';
import Documents from 'server/src/components/documents/Documents';
import { Card } from 'server/src/components/ui/Card';
import { SelectOption } from 'server/src/components/ui/CustomSelect';
import { getDistinctEntityTypes } from '@product/actions/document-actions/documentActions';
import { getCurrentUser, getAllUsers } from '@product/actions/user-actions/userActions';
import { IUserWithRoles } from 'server/src/interfaces/index';
import { toast } from 'react-hot-toast';
import DocumentsPagination from 'server/src/components/documents/DocumentsPagination';
import DocumentFilters from 'server/src/components/documents/DocumentFilters';
import DocumentsPageSkeleton from 'server/src/components/documents/DocumentsPageSkeleton';
import { useDocuments } from 'server/src/hooks/useDocuments';

export default function DocumentsPage() {
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
        <h1 className="text-2xl font-semibold">Documents</h1>
      </div>

      <div className="flex gap-6">
        {/* Left Column - Filters */}
        <div className="w-80">
          <DocumentFilters
            filters={filterInputs}
            onFiltersChange={handleFiltersChange}
            onClearFilters={handleClearFilters}
            entityTypeOptions={entityTypeOptions}
            allUsersData={allUsersData}
          />
        </div>

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
