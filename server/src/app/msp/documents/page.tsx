"use client";

import { useState, useEffect, KeyboardEvent } from 'react';
import { IDocument } from 'server/src/interfaces/document.interface';
import Documents from 'server/src/components/documents/Documents';
import { Card } from 'server/src/components/ui/Card';
import { Input } from 'server/src/components/ui/Input';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import { getAllDocuments } from 'server/src/lib/actions/document-actions/documentActions';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { toast } from 'react-hot-toast';

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<IDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  const [filterInputs, setFilterInputs] = useState({
    type: 'all',
    entityType: '',
    searchTerm: ''
  });

  const documentTypes: SelectOption[] = [
    { value: 'application/pdf', label: 'PDF' },
    { value: 'image', label: 'Images' },
    { value: 'text', label: 'Documents' },
    { value: 'application', label: 'Other' }
  ];

  const entityTypes: SelectOption[] = [
    { value: 'ticket', label: 'Tickets' },
    { value: 'company', label: 'Clients' },
    { value: 'contact', label: 'Contacts' },
    { value: 'schedule', label: 'Schedules' }
  ];

  const handleSearch = async () => {
    try {
      setIsLoading(true);
      setError(null);
      console.log('Fetching documents with filters:', filterInputs);

      // Only include filters that have values
      const searchFilters = {
        ...(filterInputs.type !== 'all' && { type: filterInputs.type }),
        ...(filterInputs.entityType && { entityType: filterInputs.entityType }),
        ...(filterInputs.searchTerm && { searchTerm: filterInputs.searchTerm })
      };

      const docs = await getAllDocuments(searchFilters);
      console.log('Fetched documents:', docs);

      if (!Array.isArray(docs)) {
        console.error('Received non-array documents:', docs);
        setDocuments([]);
        setError('Invalid document data received');
        return;
      }

      setDocuments(docs);
    } catch (error) {
      console.error('Error fetching documents:', error);
      setError('Failed to fetch documents');
      toast.error('Failed to fetch documents');
      setDocuments([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!initialized && filterInputs.searchTerm === '') {
        return;
    }

    const timerId = setTimeout(() => {
      if (initialized || filterInputs.searchTerm) {
        handleSearch();
      }
    }, 500);

    return () => {
      clearTimeout(timerId);
    };
  }, [filterInputs.searchTerm, initialized]);

  // Initialize data
  useEffect(() => {
    let mounted = true;

    const initialize = async () => {
      if (initialized) return;

      try {
        setIsLoading(true);
        setError(null);

        // Fetch user first
        const user = await getCurrentUser();
        if (!mounted) return;

        if (user) {
          setCurrentUserId(user.user_id);
          // Fetch documents after we have the user
          await handleSearch();
        } else {
          setError('No user found');
          toast.error('No user found');
        }
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


  const handleDocumentUpdate = async () => {
    await handleSearch();
  };
  const handleClearFilters = () => {
    // Create cleared filters object
    const clearedFilters = {
      type: 'all',
      entityType: '',
      searchTerm: ''
    };

    // Update the filter inputs state
    setFilterInputs(clearedFilters);

    try {
      setIsLoading(true);
      setError(null);
      console.log('Fetching all documents after clearing filters');

      // Call getAllDocuments with empty filters
      getAllDocuments({}).then(docs => {
        console.log('Received documents after clearing filters:', docs.length);
        if (Array.isArray(docs)) {
          setDocuments(docs);
        } else {
          console.error('Received non-array documents:', docs);
          setDocuments([]);
          setError('Invalid document data received');
        }
      }).catch(error => {
        console.error('Error fetching documents:', error);
        setError('Failed to fetch documents');
        toast.error('Failed to fetch documents');
        setDocuments([]);
      }).finally(() => {
        setIsLoading(false);
      });
    } catch (error) {
      console.error('Error in handleClearFilters:', error);
      setIsLoading(false);
    }
  };

  // Debug log for rendering
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
                  value={filterInputs.type}
                  placeholder='All Document Types'
                  onValueChange={(value: string) => {
                    if (value == 'placeholder') {
                      value = 'all';
                    }

                    // Update state
                    setFilterInputs({ ...filterInputs, type: value });
                    
                    // Call search with the new value directly instead of relying on state update
                    const searchFilters = {
                      ...(value !== 'all' && { type: value }),
                      ...(filterInputs.entityType && { entityType: filterInputs.entityType }),
                      ...(filterInputs.searchTerm && { searchTerm: filterInputs.searchTerm })
                    };
                    
                    // Set loading state
                    setIsLoading(true);
                    setError(null);
                    
                    // Execute search with the new filters
                    getAllDocuments(searchFilters)
                      .then(docs => {
                        if (Array.isArray(docs)) {
                          setDocuments(docs);
                        } else {
                          console.error('Received non-array documents:', docs);
                          setDocuments([]);
                          setError('Invalid document data received');
                        }
                      })
                      .catch(error => {
                        console.error('Error fetching documents:', error);
                        setError('Failed to fetch documents');
                        toast.error('Failed to fetch documents');
                        setDocuments([]);
                      })
                      .finally(() => {
                        setIsLoading(false);
                      });
                  }}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Entity Type
                </label>
                <CustomSelect
                  options={entityTypes}
                  value={filterInputs.entityType}
                  onValueChange={(value: string) => {
                    if (value === 'placeholder') {
                      value = '';
                    }

                    // Update state
                    setFilterInputs({ ...filterInputs, entityType: value });
                    
                    // Call search with the new value directly instead of relying on state update
                    const searchFilters = {
                      ...(filterInputs.type !== 'all' && { type: filterInputs.type }),
                      ...(value && { entityType: value }),
                      ...(filterInputs.searchTerm && { searchTerm: filterInputs.searchTerm })
                    };
                    
                    // Set loading state
                    setIsLoading(true);
                    setError(null);
                    
                    // Execute search with the new filters
                    getAllDocuments(searchFilters)
                      .then(docs => {
                        if (Array.isArray(docs)) {
                          setDocuments(docs);
                        } else {
                          console.error('Received non-array documents:', docs);
                          setDocuments([]);
                          setError('Invalid document data received');
                        }
                      })
                      .catch(error => {
                        console.error('Error fetching documents:', error);
                        setError('Failed to fetch documents');
                        toast.error('Failed to fetch documents');
                        setDocuments([]);
                      })
                      .finally(() => {
                        setIsLoading(false);
                      });
                  }}
                  placeholder="All Entities"
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
          </Card>
        </div>
      </div>
    </div>
  );
}
