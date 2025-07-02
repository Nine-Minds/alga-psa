import { NextRequest, NextResponse } from 'next/server';

// Extended dummy agreement data matching the list
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
    },
    // Additional details for detail view
    startDate: '2024-01-01',
    endDate: '2024-12-31',
    billingCycle: 'monthly',
    paymentTerms: 'Net 30',
    description: 'Enterprise license agreement for Microsoft 365 E3 services including Office applications, Teams, SharePoint, and Exchange.',
    contactPerson: 'John Smith',
    contactEmail: 'john.smith@acmecorp.com',
    licenseCount: 250,
    pricePerLicense: 500
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
    },
    startDate: '2024-02-01',
    endDate: '2025-01-31',
    billingCycle: 'annual',
    paymentTerms: 'Net 15',
    description: 'Creative Cloud business license for design and creative applications.',
    contactPerson: 'Sarah Johnson',
    contactEmail: 'sarah@designstudio.com',
    licenseCount: 15,
    pricePerLicense: 3000
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
    },
    startDate: '2024-03-01',
    endDate: '2025-02-28',
    billingCycle: 'monthly',
    paymentTerms: 'Net 30',
    description: 'Salesforce Professional CRM platform with sales automation and customer management.',
    contactPerson: 'Mike Chen',
    contactEmail: 'mike.chen@techinnovations.com',
    licenseCount: 50,
    pricePerLicense: 1500
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
    },
    startDate: '2024-01-15',
    endDate: '2025-01-14',
    billingCycle: 'monthly',
    paymentTerms: 'Net 30',
    description: 'Enterprise support for AWS cloud infrastructure and services.',
    contactPerson: 'David Wilson',
    contactEmail: 'david.wilson@cloudfirst.com',
    licenseCount: 1,
    pricePerLicense: 200000
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
    },
    startDate: '2023-06-01',
    endDate: '2024-05-31',
    billingCycle: 'annual',
    paymentTerms: 'Net 15',
    description: 'Business collaboration platform with advanced features and compliance tools.',
    contactPerson: 'Lisa Brown',
    contactEmail: 'lisa@remoteteam.co',
    licenseCount: 30,
    pricePerLicense: 600
  }
];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
  const { id } = resolvedParams;
    
    // Find the agreement by ID
    const agreement = dummyAgreements.find(agr => agr.id === id);
    
    if (!agreement) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Agreement not found' 
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: agreement
    });
  } catch (error) {
    console.error('Error fetching agreement:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch agreement' 
      },
      { status: 500 }
    );
  }
}