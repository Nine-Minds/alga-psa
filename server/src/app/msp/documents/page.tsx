"use client";

import { useState, useEffect, KeyboardEvent } from 'react';
import { IDocument, DocumentFilters } from 'server/src/interfaces/document.interface';
import Documents from 'server/src/components/documents/Documents';
import { Card } from 'server/src/components/ui/Card';
import { Input } from 'server/src/components/ui/Input';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import { getAllDocuments, getDistinctEntityTypes } from 'server/src/lib/actions/document-actions/documentActions';
import { getCurrentUser, getAllUsers } from 'server/src/lib/actions/user-actions/userActions';
import { IUserWithRoles } from 'server/src/interfaces/index';
import { toast } from 'react-hot-toast';
import DocumentsPagination from 'server/src/components/documents/DocumentsPagination';
import { DatePicker } from 'server/src/components/ui/DatePicker';
import UserPicker from 'server/src/components/ui/UserPicker';

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<IDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [allUsersData, setAllUsersData] = useState<IUserWithRoles[]>([]);
  const [entityTypeOptions, setEntityTypeOptions] = useState<SelectOption[]>([]);

  const [filterInputs, setFilterInputs] = useState<DocumentFilters>({
    type: 'all',
    entityType: '',
    searchTerm: '',
    uploadedBy: '',
    updated_at_start: '',
    updated_at_end: ''
  });

  const documentTypes: SelectOption[] = [
    { value: 'all', label: 'All Document Types' },
    { value: 'application/pdf', label: 'PDF' },
    { value: 'image', label: 'Images' },
    { value: 'text', label: 'Documents' },
    { value: 'application', label: 'Other' }
  ];

  const capitalizeFirstLetter = (string: string) => {
    return string.charAt(0).toUpperCase() + string.slice(1);
  };

  const fetchDocumentsForPage = async (page: number, filters = filterInputs) => {
    try {
      setIsLoading(true);
      setError(null);
      console.log('Fetching documents with filters:', filters, 'for page:', page);

      const searchFilters = {
        ...(filters.type !== 'all' && { type: filters.type }),
        ...(filters.entityType && { entityType: filters.entityType }),
        ...(filters.searchTerm && { searchTerm: filters.searchTerm }),
        ...(filters.uploadedBy && { uploadedBy: filters.uploadedBy }),
        ...(filters.updated_at_start && { updated_at_start: filters.updated_at_start }),
        ...(filters.updated_at_end && { updated_at_end: filters.updated_at_end })
      };

      const response = await getAllDocuments(searchFilters, page, pageSize);
      console.log('Fetched documents response:', response);

      if (response && Array.isArray(response.documents)) {
        setDocuments(response.documents);
        setTotalPages(response.totalPages);
        setCurrentPage(response.currentPage);
      } else {
        console.error('Received invalid documents data:', response);
        setDocuments([]);
        setTotalPages(1);
        setCurrentPage(1);
        setError('Invalid document data received');
      }
    } catch (error) {
      console.error('Error fetching documents:', error);
      setError('Failed to fetch documents');
      toast.error('Failed to fetch documents');
      setDocuments([]);
      setTotalPages(1);
      setCurrentPage(1);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!initialized && filterInputs.searchTerm === '') {
      return;
    }
    const timerId = setTimeout(() => {
      setCurrentPage(1);
      fetchDocumentsForPage(1, filterInputs);
    }, 500);

    return () => {
      clearTimeout(timerId);
    };
  }, [
    filterInputs.searchTerm,
    filterInputs.type,
    filterInputs.entityType,
    filterInputs.uploadedBy,
    filterInputs.updated_at_start,
    filterInputs.updated_at_end,
    initialized
  ]);

 useEffect(() => {
    if (initialized) {
        fetchDocumentsForPage(currentPage, filterInputs);
    }
  }, [currentPage, initialized]);

  useEffect(() => {
    let mounted = true;
    const initialize = async () => {
      if (initialized) return;

      try {
        setIsLoading(true);
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
          const options = dbEntityTypes.map(et => ({ value: et, label: capitalizeFirstLetter(et) }));
          setEntityTypeOptions([{ value: 'all_entities', label: 'All Entity Types' }, ...options]);
        } else {
          console.error('Failed to fetch entity types or response was not an array:', dbEntityTypes);
          setEntityTypeOptions([{ value: 'all_entities', label: 'All Entity Types' }]);
        }
        
        await fetchDocumentsForPage(1, filterInputs);

      } catch (error) {
        console.error('Error during initialization:', error);
        if (mounted) {
          setError('Failed to initialize');
          toast.error('Failed to initialize');
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
          setInitialized(true);
        }
      }
    };

    initialize();
    return () => {
      mounted = false;
    };
  }, []); // Run once on mount

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
  };

  const handleDocumentUpdate = async () => {
    await fetchDocumentsForPage(currentPage, filterInputs);
  };

  const handleClearFilters = () => {
    const clearedFilters = {
      type: 'all',
      entityType: '',
      searchTerm: '',
      uploadedBy: '',
      updated_at_start: '',
      updated_at_end: ''
    };
    setFilterInputs(clearedFilters);
    setCurrentPage(1);
  };

  console.log('Rendering DocumentsPage with:', {
    documentsLength: documents.length,
    isLoading,
    currentUserId,
    error,
    initialized
  });

  if (!initialized) {
    return (
      <div className="p-6">
        <div className="flex justify-center items-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#6941C6]"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Documents</h1>
      </div>

      <div className="flex gap-6">
        {/* Left Column - Filters */}
        <div className="w-80">
          <Card className="p-4 sticky top-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Search Documents
                </label>
                <Input
                  placeholder="Search by document name..."
                  value={filterInputs.searchTerm}
                  onChange={(e) => setFilterInputs({ ...filterInputs, searchTerm: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Document Type
                </label>
                <CustomSelect
                  options={documentTypes}
                  value={filterInputs.type || 'all'}
                  onValueChange={(value: string) => {
                    setFilterInputs({ ...filterInputs, type: value });
                  }}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Associated Entity Type
                </label>
                <CustomSelect
                  options={entityTypeOptions}
                  value={filterInputs.entityType || 'all_entities'}
                  onValueChange={(value: string) => {
                    if (value === 'all_entities') {
                      setFilterInputs({ ...filterInputs, entityType: '' });
                    } else {
                      setFilterInputs({ ...filterInputs, entityType: value });
                    }
                  }}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Uploaded By
                </label>
                <UserPicker
                  users={allUsersData}
                  value={filterInputs.uploadedBy || ''}
                  onValueChange={(value: string) => {
                    setFilterInputs({ ...filterInputs, uploadedBy: value });
                  }}
                  placeholder="All Users"
                  buttonWidth="full"
                  className="w-full"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Updated Date Start
                </label>
                <DatePicker
                  value={filterInputs.updated_at_start ? new Date(filterInputs.updated_at_start) : undefined}
                  onChange={(date: Date | null) => setFilterInputs({ ...filterInputs, updated_at_start: date ? date.toISOString().split('T')[0] : '' })}
                  placeholder="Select start date"
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Updated Date End
                </label>
                 <DatePicker
                  value={filterInputs.updated_at_end ? new Date(filterInputs.updated_at_end) : undefined}
                  onChange={(date: Date | null) => setFilterInputs({ ...filterInputs, updated_at_end: date ? date.toISOString().split('T')[0] : '' })}
                  placeholder="Select end date"
                  className="w-full"
                />
              </div>

              <div className="pt-4">
                <button
                  onClick={handleClearFilters}
                  className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                  Clear Filters
                </button>
              </div>
            </div>
          </Card>
        </div>

        {/* Right Column - Documents */}
        <div className="flex-1">
          <Card className="p-4">
            {error ? (
              <div className="text-center py-4 text-red-500 bg-red-50 rounded-md">
                {error}
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
            {/* Pagination controls for the main page list */}
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
