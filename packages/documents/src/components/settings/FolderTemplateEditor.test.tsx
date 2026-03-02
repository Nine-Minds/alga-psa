/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import FolderTemplateEditor from './FolderTemplateEditor';
import type { IDocumentFolderTemplate, IDocumentFolderTemplateItem } from '@alga-psa/documents/actions';

vi.mock('react-hot-toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError: vi.fn(),
}));

const mockTemplate: IDocumentFolderTemplate & { items: IDocumentFolderTemplateItem[] } = {
  template_id: 'template-1',
  tenant: 'tenant-1',
  name: 'Client Default',
  entity_type: 'client',
  is_default: true,
  created_at: '2026-02-28T00:00:00Z',
  updated_at: '2026-02-28T00:00:00Z',
  items: [
    {
      template_item_id: 'item-1',
      tenant: 'tenant-1',
      template_id: 'template-1',
      parent_item_id: null,
      folder_name: 'Contracts',
      folder_path: '/Contracts',
      is_client_visible: true,
      sort_order: 0,
    },
    {
      template_item_id: 'item-2',
      tenant: 'tenant-1',
      template_id: 'template-1',
      parent_item_id: null,
      folder_name: 'Invoices',
      folder_path: '/Invoices',
      is_client_visible: false,
      sort_order: 1,
    },
  ],
};

vi.mock('@alga-psa/documents/actions', async () => {
  const actual = await vi.importActual('@alga-psa/documents/actions');
  return {
    ...actual,
    getFolderTemplate: vi.fn().mockResolvedValue(mockTemplate),
    createFolderTemplate: vi.fn().mockResolvedValue(mockTemplate),
    updateFolderTemplate: vi.fn().mockResolvedValue(mockTemplate),
  };
});

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, onClick, disabled, variant, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));

vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: ({ checked, onCheckedChange, ...props }: any) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      {...props}
    />
  ),
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
    <h3 className={className}>{children}</h3>
  ),
}));

vi.mock('@alga-psa/ui/components/Select', () => ({
  Select: ({ children, value, onValueChange }: any) => (
    <div data-testid="select" data-value={value}>
      {children}
    </div>
  ),
  SelectTrigger: ({ children }: any) => <div data-testid="select-trigger">{children}</div>,
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
  SelectContent: ({ children }: any) => <div data-testid="select-content">{children}</div>,
  SelectItem: ({ children, value }: any) => (
    <div data-testid={`select-item-${value}`} data-value={value}>{children}</div>
  ),
}));

describe('FolderTemplateEditor', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders with folder tree when editing existing template', async () => {
    render(<FolderTemplateEditor templateId="template-1" />);

    await waitFor(() => {
      expect(screen.getByText('Contracts')).toBeInTheDocument();
      expect(screen.getByText('Invoices')).toBeInTheDocument();
    });
  });

  it('renders template name input', async () => {
    render(<FolderTemplateEditor templateId="template-1" />);

    await waitFor(() => {
      const nameInput = screen.getByDisplayValue('Client Default');
      expect(nameInput).toBeInTheDocument();
    });
  });

  it('renders entity type selector', async () => {
    render(<FolderTemplateEditor templateId="template-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('select')).toBeInTheDocument();
    });
  });

  it('renders add folder button', async () => {
    render(<FolderTemplateEditor templateId="template-1" />);

    await waitFor(() => {
      expect(screen.getByText('Add Folder')).toBeInTheDocument();
    });
  });

  it('renders save and cancel buttons', async () => {
    const onCancel = vi.fn();
    render(<FolderTemplateEditor templateId="template-1" onCancel={onCancel} />);

    await waitFor(() => {
      expect(screen.getByText('Save Template')).toBeInTheDocument();
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });
  });

  it('shows visibility toggle per folder item', async () => {
    render(<FolderTemplateEditor templateId="template-1" />);

    await waitFor(() => {
      // Should have visibility checkboxes for each folder
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes.length).toBeGreaterThan(0);
    });
  });

  it('calls onCancel when cancel button is clicked', async () => {
    const onCancel = vi.fn();
    render(<FolderTemplateEditor templateId="template-1" onCancel={onCancel} />);

    await waitFor(() => {
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('renders empty tree for new template', async () => {
    render(<FolderTemplateEditor />);

    // Should show "Add Folder" to start building the tree
    expect(screen.getByText('Add Folder')).toBeInTheDocument();
  });

  it('renders is_default toggle for template', async () => {
    render(<FolderTemplateEditor templateId="template-1" />);

    await waitFor(() => {
      expect(screen.getByText('Default Template')).toBeInTheDocument();
    });
  });
});
