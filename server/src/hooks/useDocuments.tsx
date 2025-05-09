'use client';

import { useState, useEffect, useCallback } from 'react';
import type { DocumentFilters, IDocument } from 'server/src/interfaces/document.interface';
import { getAllDocuments } from 'server/src/lib/actions/document-actions/documentActions';
import { toast } from 'react-hot-toast';

/**
 * Custom hook for fetching and managing documents with filtering and pagination
 * 
 * @param filters Document filters
 * @param page Current page number
 * @param pageSize Number of items per page
 * @returns Document data, loading state, and error information
 */
export function useDocuments(
  filters: DocumentFilters, 
  page: number, 
  pageSize: number
) {
  const [documents, setDocuments] = useState<IDocument[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Debounce filters to prevent excessive API calls
  const debouncedFilters = useDebounce(filters, 500);
  
  /**
   * Fetch documents based on current filters and pagination
   */
  const fetchDocuments = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      console.log('Fetching documents with filters:', debouncedFilters, 'for page:', page);
      
      const response = await getAllDocuments(debouncedFilters, page, pageSize);
      
      if (response && Array.isArray(response.documents)) {
        setDocuments(response.documents);
        setTotalCount(response.totalCount);
      } else {
        console.error('Received invalid documents data:', response);
        setDocuments([]);
        setTotalCount(0);
        setError('Invalid document data received');
      }
    } catch (error) {
      console.error('Error fetching documents:', error);
      setError('Failed to fetch documents');
      toast.error('Failed to fetch documents');
      setDocuments([]);
      setTotalCount(0);
    } finally {
      setIsLoading(false);
    }
  }, [debouncedFilters, page, pageSize]);
  
  // Fetch documents when filters or pagination changes
  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);
  
  return { 
    documents, 
    totalCount, 
    isLoading, 
    error,
    refetch: fetchDocuments
  };
}

/**
 * Simple debounce hook for delaying value updates
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    
    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);
  
  return debouncedValue;
}