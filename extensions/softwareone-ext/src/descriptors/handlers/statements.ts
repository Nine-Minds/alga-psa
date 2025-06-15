import { HandlerContext } from './types';

/**
 * Statement handlers for SoftwareOne extension
 */

export async function navigateToStatementDetail(event: MouseEvent, context: HandlerContext, params?: { statementId: string }) {
  event.preventDefault();
  if (params?.statementId) {
    context.navigate(`/softwareone/statement/${params.statementId}`);
  }
}

export async function viewStatementDetails(event: MouseEvent, context: HandlerContext, params?: { statementId: string }) {
  event.preventDefault();
  if (params?.statementId) {
    context.navigate(`/softwareone/statement/${params.statementId}`);
  }
}

export async function refreshStatements(event: MouseEvent, context: HandlerContext) {
  try {
    context.ui.toast('Refreshing statements...', 'info');
    
    // Trigger refresh via API
    const response = await context.api.post(`/api/extensions/${context.extension.id}/sync`, {
      syncAgreements: false,
      syncStatements: true
    });

    if (response.data.success) {
      context.ui.toast(`Refreshed ${response.data.statementsCount} statements`, 'success');
      // Refresh the table
      if (context.table) {
        context.table.refresh();
      }
    } else {
      context.ui.toast('Failed to refresh statements', 'error');
    }
  } catch (error) {
    console.error('Failed to refresh statements:', error);
    context.ui.toast('Failed to refresh statements', 'error');
  }
}

export async function importStatement(event: MouseEvent, context: HandlerContext, params?: { statementId: string }) {
  if (!params?.statementId) return;
  
  try {
    const confirmed = await context.ui.confirm(
      'Import this statement to Alga PSA billing? This will create draft invoice items.',
      'Import Statement'
    );
    
    if (!confirmed) return;
    
    // Call import API
    const response = await context.api.post(`/api/extensions/${context.extension.id}/statements/${params.statementId}/import`);
    
    if (response.data.success) {
      context.ui.toast(`Statement imported successfully. Invoice #${response.data.invoiceNumber} created.`, 'success');
      // Refresh the table
      if (context.table) {
        context.table.refresh();
      }
    } else {
      context.ui.toast('Failed to import statement: ' + response.data.error, 'error');
    }
  } catch (error) {
    console.error('Failed to import statement:', error);
    context.ui.toast('Failed to import statement', 'error');
  }
}

export async function importStatements(event: MouseEvent, context: HandlerContext) {
  try {
    // Show import wizard dialog
    const result = await context.ui.dialog({
      type: 'wizard',
      steps: [
        {
          key: 'select',
          label: 'Select Statements',
          content: {
            type: 'div',
            children: [
              {
                type: 'p',
                children: ['Select statements to import to Alga PSA billing.']
              }
            ]
          }
        },
        {
          key: 'mapping',
          label: 'Service Mapping',
          content: {
            type: 'div',
            children: [
              {
                type: 'p',
                children: ['Map statement items to your service catalog.']
              }
            ]
          }
        },
        {
          key: 'review',
          label: 'Review & Import',
          content: {
            type: 'div',
            children: [
              {
                type: 'p',
                children: ['Review the import details before proceeding.']
              }
            ]
          }
        }
      ]
    });
    
    if (result) {
      context.ui.toast('Import completed successfully', 'success');
      if (context.table) {
        context.table.refresh();
      }
    }
  } catch (error) {
    console.error('Import failed:', error);
    context.ui.toast('Import failed', 'error');
  }
}

export async function importSelectedStatements(event: MouseEvent, context: HandlerContext) {
  if (!context.table || context.table.selectedRows.length === 0) {
    context.ui.toast('Please select statements to import', 'warning');
    return;
  }
  
  try {
    const count = context.table.selectedRows.length;
    const confirmed = await context.ui.confirm(
      `Import ${count} selected statement${count > 1 ? 's' : ''} to Alga PSA billing?`,
      'Import Statements'
    );
    
    if (!confirmed) return;
    
    // Call bulk import API
    const statementIds = context.table.selectedRows.map(row => row.id);
    const response = await context.api.post(`/api/extensions/${context.extension.id}/statements/import-bulk`, {
      statementIds
    });
    
    if (response.data.success) {
      context.ui.toast(`Imported ${response.data.importedCount} statements successfully`, 'success');
      context.table.setSelectedRows([]);
      context.table.refresh();
    } else {
      context.ui.toast('Failed to import statements: ' + response.data.error, 'error');
    }
  } catch (error) {
    console.error('Failed to import statements:', error);
    context.ui.toast('Failed to import statements', 'error');
  }
}

export async function navigateToStatements(event: MouseEvent, context: HandlerContext) {
  event.preventDefault();
  context.navigate('/softwareone/statements');
}

export async function navigateToAgreement(event: MouseEvent, context: HandlerContext, params?: { agreementId: string }) {
  event.preventDefault();
  if (params?.agreementId) {
    context.navigate(`/softwareone/agreement/${params.agreementId}`);
  }
}

export async function downloadStatement(event: MouseEvent, context: HandlerContext, params?: { statementId: string }) {
  if (!params?.statementId) return;
  
  try {
    const response = await context.api.get(`/api/extensions/${context.extension.id}/statements/${params.statementId}/download`, {
      responseType: 'blob'
    });
    
    // Create download
    const blob = new Blob([response.data], { type: 'application/pdf' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `statement-${params.statementId}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    context.ui.toast('Statement downloaded successfully', 'success');
  } catch (error) {
    console.error('Failed to download statement:', error);
    context.ui.toast('Failed to download statement', 'error');
  }
}

export async function viewInvoice(event: MouseEvent, context: HandlerContext, params?: { invoiceNumber: string }) {
  event.preventDefault();
  if (params?.invoiceNumber) {
    // Navigate to Alga PSA invoice
    context.navigate(`/invoices/${params.invoiceNumber}`);
  }
}

/**
 * Load statements data (for dummy data during development)
 */
export async function loadStatements(context: HandlerContext) {
  // This will be replaced by actual API calls
  const dummyStatements = [
    {
      id: '1',
      statementNumber: 'STMT-2024-001',
      period: '2024-01',
      consumer: 'Acme Corporation',
      consumerId: 'acme-corp',
      totalAmount: 45000,
      currency: 'USD',
      status: 'pending',
      dueDate: '2024-02-15',
      createdAt: '2024-01-31'
    },
    {
      id: '2',
      statementNumber: 'STMT-2024-002',
      period: '2024-02',
      consumer: 'Design Studios Inc',
      consumerId: 'design-studios',
      totalAmount: 22500,
      currency: 'USD',
      status: 'processed',
      dueDate: '2024-03-15',
      importedAt: '2024-02-28',
      invoiceNumber: 'INV-2024-0234',
      createdAt: '2024-02-28'
    },
    {
      id: '3',
      statementNumber: 'STMT-2024-003',
      period: '2024-03',
      consumer: 'Global Sales Corp',
      consumerId: 'global-sales',
      totalAmount: 68000,
      currency: 'USD',
      status: 'pending',
      dueDate: '2024-04-15',
      createdAt: '2024-03-31'
    }
  ];
  
  return dummyStatements;
}

/**
 * Load statement charges (dummy data)
 */
export async function loadStatementCharges(statementId: string, context: HandlerContext) {
  const dummyCharges: Record<string, any[]> = {
    '1': [
      {
        id: '1-1',
        statementId: '1',
        description: 'Microsoft 365 E3 - Monthly subscription',
        product: 'Microsoft 365 E3',
        quantity: 50,
        unitPrice: 35,
        totalAmount: 1750,
        agreementId: '1'
      },
      {
        id: '1-2',
        statementId: '1',
        description: 'Azure Consumption - January 2024',
        product: 'Azure Pay-As-You-Go',
        quantity: 1,
        unitPrice: 43250,
        totalAmount: 43250
      }
    ],
    '2': [
      {
        id: '2-1',
        statementId: '2',
        description: 'Adobe Creative Cloud - All Apps',
        product: 'Creative Cloud All Apps',
        quantity: 30,
        unitPrice: 75,
        totalAmount: 2250,
        agreementId: '2'
      },
      {
        id: '2-2',
        statementId: '2',
        description: 'Adobe Stock - 750 assets',
        product: 'Adobe Stock',
        quantity: 1,
        unitPrice: 20250,
        totalAmount: 20250
      }
    ],
    '3': [
      {
        id: '3-1',
        statementId: '3',
        description: 'Salesforce Sales Cloud Enterprise',
        product: 'Sales Cloud Enterprise',
        quantity: 100,
        unitPrice: 150,
        totalAmount: 15000,
        agreementId: '3'
      },
      {
        id: '3-2',
        statementId: '3',
        description: 'Salesforce Service Cloud',
        product: 'Service Cloud Professional',
        quantity: 50,
        unitPrice: 75,
        totalAmount: 3750
      },
      {
        id: '3-3',
        statementId: '3',
        description: 'Salesforce Marketing Cloud',
        product: 'Marketing Cloud',
        quantity: 1,
        unitPrice: 49250,
        totalAmount: 49250
      }
    ]
  };
  
  return dummyCharges[statementId] || [];
}