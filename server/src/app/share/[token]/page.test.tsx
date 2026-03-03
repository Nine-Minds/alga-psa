/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import '@testing-library/jest-dom';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import ShareLandingPage from './page';

const mockToken = 'test-token-123';

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: mockToken }),
}));

const mockShareInfo = {
  documentName: 'Important Report.pdf',
  mimeType: 'application/pdf',
  fileSize: 1024000,
  shareType: 'public',
  requiresPassword: false,
  requiresAuth: false,
  expiresAt: null,
  maxDownloads: null,
  downloadCount: 5,
};

const mockPasswordShareInfo = {
  documentName: 'Secret Document.pdf',
  mimeType: 'application/pdf',
  fileSize: 512000,
  shareType: 'password',
  requiresPassword: true,
  requiresAuth: false,
  expiresAt: null,
  maxDownloads: 10,
  downloadCount: 3,
};

const mockExpiredShareInfo = {
  documentName: 'Expired Document.pdf',
  mimeType: 'application/pdf',
  fileSize: 256000,
  shareType: 'public',
  requiresPassword: false,
  requiresAuth: false,
  expiresAt: '2020-01-01T00:00:00Z', // Past date
  maxDownloads: null,
  downloadCount: 0,
};

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, onClick, disabled, className, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} className={className} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className} data-testid="card">{children}</div>
  ),
  CardContent: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  CardHeader: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  CardTitle: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <h2 className={className}>{children}</h2>
  ),
  CardDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children, variant }: { children: React.ReactNode; variant?: string }) => (
    <div data-testid="alert" data-variant={variant}>{children}</div>
  ),
  AlertDescription: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

describe('ShareLandingPage', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders document info and download button for public share', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockShareInfo),
    });

    render(<ShareLandingPage />);

    await waitFor(() => {
      expect(screen.getByText('Important Report.pdf')).toBeInTheDocument();
    });

    expect(screen.getByText(/Download File/)).toBeInTheDocument();
  });

  it('shows password input for password-protected links', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockPasswordShareInfo),
    });

    render(<ShareLandingPage />);

    await waitFor(() => {
      expect(screen.getByText('Secret Document.pdf')).toBeInTheDocument();
    });

    expect(screen.getByPlaceholderText('Enter password')).toBeInTheDocument();
    expect(screen.getByText(/Password Required/)).toBeInTheDocument();
  });

  it('shows expiry message for expired links', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockExpiredShareInfo),
    });

    render(<ShareLandingPage />);

    await waitFor(() => {
      expect(screen.getByText(/expired/i)).toBeInTheDocument();
    });
  });

  it('shows download count for links with max downloads', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockPasswordShareInfo),
    });

    render(<ShareLandingPage />);

    await waitFor(() => {
      expect(screen.getByText(/3 of 10 downloads used/)).toBeInTheDocument();
    });
  });

  it('disables download button when password required but not entered', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockPasswordShareInfo),
    });

    render(<ShareLandingPage />);

    await waitFor(() => {
      const downloadButton = screen.getByText(/Download File/).closest('button');
      expect(downloadButton).toBeDisabled();
    });
  });

  it('enables download button when password is entered', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockPasswordShareInfo),
    });

    render(<ShareLandingPage />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Enter password')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('Enter password'), {
      target: { value: 'secret123' },
    });

    const downloadButton = screen.getByText(/Download File/).closest('button');
    expect(downloadButton).not.toBeDisabled();
  });

  it('shows file size information', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockShareInfo),
    });

    render(<ShareLandingPage />);

    await waitFor(() => {
      // File size should be formatted (1MB for 1024000 bytes)
      expect(screen.getByText(/MB|KB/)).toBeInTheDocument();
    });
  });

  it('shows error message when link is not valid', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Link not found' }),
    });

    render(<ShareLandingPage />);

    await waitFor(() => {
      expect(screen.getByText('Link Not Available')).toBeInTheDocument();
    });
  });

  it('shows loading state initially', () => {
    mockFetch.mockImplementation(() => new Promise(() => {})); // Never resolves

    render(<ShareLandingPage />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows download limit reached message', async () => {
    const limitReachedInfo = {
      ...mockPasswordShareInfo,
      downloadCount: 10,
      maxDownloads: 10,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(limitReachedInfo),
    });

    render(<ShareLandingPage />);

    await waitFor(() => {
      expect(screen.getByText(/Download limit has been reached/)).toBeInTheDocument();
    });
  });
});
