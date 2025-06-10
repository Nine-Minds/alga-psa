import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Companies from '../Companies';
import * as companyActions from 'server/src/lib/actions/company-actions/companyActions';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from 'server/src/hooks/use-toast';

// Mock the required modules
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
  usePathname: vi.fn(() => '/msp/companies'),
}));

vi.mock('server/src/hooks/use-toast', () => ({
  useToast: vi.fn(),
}));

vi.mock('server/src/lib/actions/company-actions/companyActions', () => ({
  getAllCompaniesPaginated: vi.fn(),
  deleteCompany: vi.fn(),
  updateCompany: vi.fn(),
  exportCompaniesToCSV: vi.fn(),
  importCompaniesFromCSV: vi.fn(),
}));

vi.mock('server/src/lib/actions/user-actions/userActions', () => ({
  getCurrentUser: vi.fn(() => Promise.resolve({ user_id: 'test-user' })),
  getUserPreference: vi.fn(() => Promise.resolve('grid')),
  setUserPreference: vi.fn(),
}));

describe('Companies - Deactivate Company Feature', () => {
  const mockRouter = {
    push: vi.fn(),
    refresh: vi.fn(),
  };
  
  const mockToast = vi.fn();
  
  const mockCompany = {
    company_id: 'test-company-1',
    company_name: 'Test Company',
    tenant: 'test-tenant',
    is_inactive: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useRouter as any).mockReturnValue(mockRouter);
    (useSearchParams as any).mockReturnValue(new URLSearchParams());
    (useToast as any).mockReturnValue({ toast: mockToast });
    
    // Mock initial companies load
    vi.mocked(companyActions.getAllCompaniesPaginated).mockResolvedValue({
      companies: [mockCompany],
      totalCount: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });
  });

  it('should show deactivate option when delete fails due to dependencies', async () => {
    // Mock delete failure due to dependencies
    vi.mocked(companyActions.deleteCompany).mockResolvedValue({
      success: false,
      code: 'COMPANY_HAS_DEPENDENCIES',
      message: 'Company has associated records and cannot be deleted',
      dependencies: ['contacts', 'active tickets'],
      counts: { contact: 5, ticket: 3 },
    });

    const { container } = render(<Companies />);
    
    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText('Test Company')).toBeInTheDocument();
    });

    // Find and click delete button (you may need to adjust this selector based on your actual implementation)
    const deleteButton = container.querySelector('[aria-label="Delete company"]');
    if (deleteButton) {
      fireEvent.click(deleteButton);
    }

    // Confirm initial delete
    await waitFor(() => {
      expect(screen.getByText(/Are you sure you want to delete Test Company/)).toBeInTheDocument();
    });
    
    const deleteConfirmButton = screen.getByText('Delete');
    fireEvent.click(deleteConfirmButton);

    // Wait for error message with dependencies
    await waitFor(() => {
      expect(screen.getByText(/Unable to delete this company/)).toBeInTheDocument();
      expect(screen.getByText(/5 contacts/)).toBeInTheDocument();
      expect(screen.getByText(/3 active tickets/)).toBeInTheDocument();
    });

    // Check for deactivate option
    expect(screen.getByText('Deactivate Instead')).toBeInTheDocument();
    expect(screen.getByText(/You can deactivate this company instead/)).toBeInTheDocument();
  });

  it('should successfully deactivate company when deactivate button is clicked', async () => {
    // First, setup the delete failure scenario
    vi.mocked(companyActions.deleteCompany).mockResolvedValue({
      success: false,
      code: 'COMPANY_HAS_DEPENDENCIES',
      message: 'Company has associated records and cannot be deleted',
      dependencies: ['contacts'],
      counts: { contact: 2 },
    });

    // Mock successful update
    vi.mocked(companyActions.updateCompany).mockResolvedValue({
      ...mockCompany,
      is_inactive: true,
    });

    const { container } = render(<Companies />);
    
    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText('Test Company')).toBeInTheDocument();
    });

    // Trigger delete (adjust selector as needed)
    const deleteButton = container.querySelector('[aria-label="Delete company"]');
    if (deleteButton) {
      fireEvent.click(deleteButton);
    }

    // Confirm delete
    await waitFor(() => {
      expect(screen.getByText(/Are you sure you want to delete Test Company/)).toBeInTheDocument();
    });
    
    fireEvent.click(screen.getByText('Delete'));

    // Wait for deactivate option to appear
    await waitFor(() => {
      expect(screen.getByText('Deactivate Instead')).toBeInTheDocument();
    });

    // Click deactivate
    fireEvent.click(screen.getByText('Deactivate Instead'));

    // Verify update was called with correct params
    await waitFor(() => {
      expect(companyActions.updateCompany).toHaveBeenCalledWith('test-company-1', { is_inactive: true });
    });

    // Verify toast notification
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Company Deactivated',
      description: 'Test Company has been deactivated successfully.',
      variant: 'default',
    });

    // Verify dialog closed
    await waitFor(() => {
      expect(screen.queryByText(/Unable to delete this company/)).not.toBeInTheDocument();
    });
  });

  it('should not show deactivate option for other delete errors', async () => {
    // Mock generic delete failure
    vi.mocked(companyActions.deleteCompany).mockResolvedValue({
      success: false,
      message: 'Network error',
    });

    const { container } = render(<Companies />);
    
    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText('Test Company')).toBeInTheDocument();
    });

    // Trigger delete
    const deleteButton = container.querySelector('[aria-label="Delete company"]');
    if (deleteButton) {
      fireEvent.click(deleteButton);
    }

    // Confirm delete
    await waitFor(() => {
      expect(screen.getByText(/Are you sure you want to delete Test Company/)).toBeInTheDocument();
    });
    
    fireEvent.click(screen.getByText('Delete'));

    // Wait for error message
    await waitFor(() => {
      expect(screen.getByText(/An error occurred while deleting the company/)).toBeInTheDocument();
    });

    // Verify deactivate option is NOT shown
    expect(screen.queryByText('Deactivate Instead')).not.toBeInTheDocument();
  });
});