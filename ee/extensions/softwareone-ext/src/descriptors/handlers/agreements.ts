import { HandlerContext } from './types';

/**
 * Agreement handlers for SoftwareOne extension
 */

export async function navigateToAgreementDetail(event: MouseEvent, context: HandlerContext, params?: { agreementId: string }) {
  event.preventDefault();
  if (params?.agreementId) {
    context.navigate(`/softwareone/agreement/${params.agreementId}`);
  }
}

export async function refreshAgreements(event: MouseEvent, context: HandlerContext) {
  try {
    context.ui.toast('Refreshing agreements...', 'info');
    
    // Trigger refresh via API
    const response = await context.api.post(`/api/extensions/${context.extension.id}/sync`, {
      syncAgreements: true,
      syncStatements: false
    });

    if (response.data.success) {
      context.ui.toast(`Refreshed ${response.data.agreementsCount} agreements`, 'success');
      // Refresh the table
      if (context.table) {
        context.table.refresh();
      }
    } else {
      context.ui.toast('Failed to refresh agreements', 'error');
    }
  } catch (error) {
    console.error('Failed to refresh agreements:', error);
    context.ui.toast('Failed to refresh agreements', 'error');
  }
}

export async function exportAgreements(event: MouseEvent, context: HandlerContext) {
  try {
    // Get current filtered data
    const response = await context.api.get(`/api/extensions/${context.extension.id}/agreements/export`);
    
    // Create download
    const blob = new Blob([response.data], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agreements-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    context.ui.toast('Agreements exported successfully', 'success');
  } catch (error) {
    console.error('Failed to export agreements:', error);
    context.ui.toast('Failed to export agreements', 'error');
  }
}

export async function showAgreementActions(event: MouseEvent, context: HandlerContext, params?: { agreementId: string }) {
  event.stopPropagation();
  
  if (!params?.agreementId) return;
  
  // Show action menu
  const confirmed = await context.ui.confirm(
    'What would you like to do with this agreement?',
    'Agreement Actions'
  );
  
  if (confirmed) {
    // For now, just navigate to detail
    context.navigate(`/softwareone/agreement/${params.agreementId}`);
  }
}

export async function activateAgreement(event: MouseEvent, context: HandlerContext, params?: { agreementId: string }) {
  if (!params?.agreementId) return;
  
  try {
    const confirmed = await context.ui.confirm(
      'Are you sure you want to activate this agreement? This will make it available for billing.',
      'Activate Agreement'
    );
    
    if (!confirmed) return;
    
    // Call activation API
    const response = await context.api.post(`/api/extensions/${context.extension.id}/agreements/${params.agreementId}/activate`);
    
    if (response.data.success) {
      context.ui.toast('Agreement activated successfully', 'success');
      // Refresh the page
      if (context.table) {
        context.table.refresh();
      }
    } else {
      context.ui.toast('Failed to activate agreement: ' + response.data.error, 'error');
    }
  } catch (error) {
    console.error('Failed to activate agreement:', error);
    context.ui.toast('Failed to activate agreement', 'error');
  }
}

export async function deactivateAgreement(event: MouseEvent, context: HandlerContext, params?: { agreementId: string }) {
  if (!params?.agreementId) return;
  
  try {
    const confirmed = await context.ui.confirm(
      'Are you sure you want to deactivate this agreement? It will no longer be available for billing.',
      'Deactivate Agreement'
    );
    
    if (!confirmed) return;
    
    // Call deactivation API
    const response = await context.api.post(`/api/extensions/${context.extension.id}/agreements/${params.agreementId}/deactivate`);
    
    if (response.data.success) {
      context.ui.toast('Agreement deactivated successfully', 'success');
      // Refresh the page
      if (context.table) {
        context.table.refresh();
      }
    } else {
      context.ui.toast('Failed to deactivate agreement: ' + response.data.error, 'error');
    }
  } catch (error) {
    console.error('Failed to deactivate agreement:', error);
    context.ui.toast('Failed to deactivate agreement', 'error');
  }
}

export async function navigateToAgreements(event: MouseEvent, context: HandlerContext) {
  event.preventDefault();
  context.navigate('/softwareone/agreements');
}

export async function viewStatements(event: MouseEvent, context: HandlerContext, params?: { agreementId: string }) {
  if (!params?.agreementId) return;
  
  // Navigate to statements filtered by agreement
  context.navigate(`/softwareone/statements?agreementId=${params.agreementId}`);
}

export async function exportAgreement(event: MouseEvent, context: HandlerContext, params?: { agreementId: string }) {
  if (!params?.agreementId) return;
  
  try {
    const response = await context.api.get(`/api/extensions/${context.extension.id}/agreements/${params.agreementId}/export`);
    
    // Create download
    const blob = new Blob([response.data], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agreement-${params.agreementId}-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    context.ui.toast('Agreement exported successfully', 'success');
  } catch (error) {
    console.error('Failed to export agreement:', error);
    context.ui.toast('Failed to export agreement', 'error');
  }
}

/**
 * Load agreements data (for dummy data during development)
 */
export async function loadAgreements(context: HandlerContext) {
  // This will be replaced by actual API calls
  const dummyAgreements = [
    {
      id: '1',
      name: 'Microsoft 365 Enterprise',
      product: 'Microsoft 365 E3',
      vendor: 'Microsoft',
      consumer: 'Acme Corporation',
      consumerId: 'acme-corp',
      status: 'active',
      currency: 'USD',
      spxy: 150000,
      marginRpxy: 15,
      operationsVisibility: 'visible',
      createdAt: '2024-01-15',
      updatedAt: '2024-03-20'
    },
    {
      id: '2',
      name: 'Adobe Creative Cloud',
      product: 'Creative Cloud All Apps',
      vendor: 'Adobe',
      consumer: 'Design Studios Inc',
      consumerId: 'design-studios',
      status: 'active',
      currency: 'USD',
      spxy: 75000,
      marginRpxy: 12,
      operationsVisibility: 'visible',
      createdAt: '2024-02-01',
      updatedAt: '2024-03-15'
    },
    {
      id: '3',
      name: 'Salesforce CRM',
      product: 'Sales Cloud Enterprise',
      vendor: 'Salesforce',
      consumer: 'Global Sales Corp',
      consumerId: 'global-sales',
      status: 'pending',
      currency: 'USD',
      spxy: 200000,
      marginRpxy: 18,
      operationsVisibility: 'hidden',
      createdAt: '2024-03-01',
      updatedAt: '2024-03-25'
    }
  ];
  
  return dummyAgreements;
}