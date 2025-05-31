/**
 * Example integration of Tab Extensions with the Billing page
 * 
 * This shows how to integrate the TabExtensionSlot component into an existing page
 */
'use client';

import React from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { TabExtensionSlot } from '../ui/tabs/TabExtensionSlot';

/**
 * Example Billing page with tab extensions
 * 
 * This demonstrates how to integrate the TabExtensionSlot component
 * into an existing page with tabs
 */
export function BillingPageWithExtensions() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  
  // Get the current tab from URL query params (Alga's existing pattern)
  const currentTab = searchParams.get('tab') || 'overview';
  
  // Native tabs definition (from the original Billing page)
  const nativeTabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'generate-invoices', label: 'Generate Invoices' },
    { id: 'invoices', label: 'Invoices' },
    { id: 'invoice-templates', label: 'Invoice Templates' },
    { id: 'tax-rates', label: 'Tax Rates' },
    { id: 'plans', label: 'Plans' },
    { id: 'plan-bundles', label: 'Plan Bundles' },
    { id: 'service-catalog', label: 'Service Catalog' },
    { id: 'billing-cycles', label: 'Billing Cycles' },
    { id: 'time-periods', label: 'Time Periods' },
    { id: 'usage-tracking', label: 'Usage Tracking' },
    { id: 'credits', label: 'Credits' },
    { id: 'reconciliation', label: 'Reconciliation' }
  ];
  
  // Handle tab change (including extension tabs)
  const handleTabChange = (tabId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tabId);
    router.push(`${pathname}?${params.toString()}`);
  };
  
  return (
    <div className="billing-page">
      <h1 className="text-2xl font-bold mb-4">Billing</h1>
      
      <div className="tabs-container mb-4 border-b">
        <div className="flex flex-wrap">
          {/* Native tabs */}
          {nativeTabs.map(tab => (
            <button
              key={tab.id}
              className={`px-4 py-2 border-b-2 ${
                currentTab === tab.id 
                  ? 'border-primary-500 text-primary-700 font-medium' 
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
              onClick={() => handleTabChange(tab.id)}
              data-tab-id={tab.id}
              data-automation-id={`tab-${tab.id}`}
            >
              {tab.label}
            </button>
          ))}
          
          {/* Extension tabs - will render after native tabs */}
          <TabExtensionSlot 
            parentPage="billing" 
            currentTab={currentTab} 
            onTabChange={handleTabChange} 
          />
        </div>
      </div>
      
      {/* Tab content - native tabs */}
      {currentTab === 'overview' && <div>Overview Content</div>}
      {currentTab === 'generate-invoices' && <div>Generate Invoices Content</div>}
      {currentTab === 'invoices' && <div>Invoices Content</div>}
      {currentTab === 'invoice-templates' && <div>Invoice Templates Content</div>}
      {currentTab === 'tax-rates' && <div>Tax Rates Content</div>}
      {currentTab === 'plans' && <div>Plans Content</div>}
      {currentTab === 'plan-bundles' && <div>Plan Bundles Content</div>}
      {currentTab === 'service-catalog' && <div>Service Catalog Content</div>}
      {currentTab === 'billing-cycles' && <div>Billing Cycles Content</div>}
      {currentTab === 'time-periods' && <div>Time Periods Content</div>}
      {currentTab === 'usage-tracking' && <div>Usage Tracking Content</div>}
      {currentTab === 'credits' && <div>Credits Content</div>}
      {currentTab === 'reconciliation' && <div>Reconciliation Content</div>}
      
      {/* Extension tab content is handled by TabExtensionSlot */}
    </div>
  );
}