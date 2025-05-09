'use client';

import { useState, useCallback } from 'react';

/**
 * Custom hook for handling pagination logic
 * 
 * @param totalItems Total number of items to paginate
 * @param itemsPerPage Number of items to display per page
 * @returns Pagination state and handlers
 */
export function usePagination(totalItems: number, itemsPerPage: number) {
  const [currentPage, setCurrentPage] = useState(1);
  
  // Calculate total pages based on total items and items per page
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  
  // Ensure current page is within valid range when total pages changes
  if (currentPage > totalPages) {
    setCurrentPage(totalPages);
  }
  
  /**
   * Handle page change with validation
   */
  const handlePageChange = useCallback((page: number) => {
    // Ensure page is within valid range
    const validPage = Math.max(1, Math.min(page, totalPages));
    setCurrentPage(validPage);
  }, [totalPages]);
  
  return { 
    currentPage, 
    totalPages, 
    handlePageChange,
    setCurrentPage
  };
}