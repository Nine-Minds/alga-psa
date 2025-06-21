import { NextRequest, NextResponse } from 'next/server';

// Dummy agreements data for development
const dummyAgreements = [
  {
    id: 'agr-001',
    name: 'Microsoft 365 Enterprise Agreement',
    product: 'Microsoft 365 E3',
    vendor: 'Microsoft',
    consumer: 'Acme Corporation',
    status: 'active',
    currency: 'USD',
    spxy: 125000,
    marginRpxy: 15000,
    operations: 'visible',
    billingConfigId: 'cfg-001',
    localConfig: {
      autoRenewal: true,
      notificationDays: 30
    }
  },
  {
    id: 'agr-002', 
    name: 'Adobe Creative Cloud Business',
    product: 'Adobe Creative Cloud',
    vendor: 'Adobe',
    consumer: 'Design Studio LLC',
    status: 'active',
    currency: 'USD',
    spxy: 45000,
    marginRpxy: 8000,
    operations: 'visible',
    billingConfigId: 'cfg-002',
    localConfig: {
      autoRenewal: false,
      notificationDays: 60
    }
  },
  {
    id: 'agr-003',
    name: 'Salesforce Professional',
    product: 'Salesforce Professional',
    vendor: 'Salesforce',
    consumer: 'Tech Innovations Inc',
    status: 'pending',
    currency: 'USD',
    spxy: 75000,
    marginRpxy: 12000,
    operations: 'visible',
    billingConfigId: 'cfg-003',
    localConfig: {
      autoRenewal: true,
      notificationDays: 45
    }
  },
  {
    id: 'agr-004',
    name: 'AWS Enterprise Support',
    product: 'AWS Enterprise Support',
    vendor: 'Amazon Web Services',
    consumer: 'CloudFirst Solutions',
    status: 'active',
    currency: 'USD',
    spxy: 200000,
    marginRpxy: 25000,
    operations: 'visible',
    billingConfigId: 'cfg-004',
    localConfig: {
      autoRenewal: true,
      notificationDays: 30
    }
  },
  {
    id: 'agr-005',
    name: 'Slack Business+',
    product: 'Slack Business+',
    vendor: 'Slack Technologies',
    consumer: 'Remote Team Co',
    status: 'inactive',
    currency: 'USD',
    spxy: 18000,
    marginRpxy: 3000,
    operations: 'hidden',
    billingConfigId: 'cfg-005',
    localConfig: {
      autoRenewal: false,
      notificationDays: 14
    }
  }
];

export async function GET(request: NextRequest) {
  try {
    // In a real implementation, this would:
    // 1. Validate user permissions
    // 2. Get tenant context
    // 3. Fetch agreements from SoftwareOne API
    // 4. Apply filtering, sorting, pagination
    
    // For now, return dummy data
    return NextResponse.json({
      success: true,
      data: dummyAgreements,
      meta: {
        total: dummyAgreements.length,
        page: 1,
        pageSize: 50
      }
    });
  } catch (error) {
    console.error('Error fetching agreements:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch agreements' 
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Handle sync requests or other operations
    const body = await request.json();
    
    return NextResponse.json({
      success: true,
      message: 'Agreements synced successfully',
      count: dummyAgreements.length
    });
  } catch (error) {
    console.error('Error syncing agreements:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to sync agreements' 
      },
      { status: 500 }
    );
  }
}