import { NextRequest, NextResponse } from 'next/server';

// Extended dummy statement data
const dummyStatements = [
  {
    id: 'stmt-001',
    statementNumber: 'STMT-2024-001',
    period: '2024-01',
    consumer: 'Acme Corporation',
    consumerId: 'acme-corp',
    agreementName: 'Microsoft 365 Enterprise Agreement',
    agreementId: 'agr-001',
    totalAmount: 12500,
    currency: 'USD',
    lineItemCount: 15,
    status: 'finalized',
    dueDate: '2024-02-15',
    createdAt: '2024-01-15T10:00:00Z',
    importedAt: null,
    // Additional details for detail view
    subtotal: 11500,
    taxAmount: 1000,
    description: 'Monthly Microsoft 365 E3 license fees for January 2024',
    billingAddress: {
      company: 'Acme Corporation',
      street: '123 Business Ave',
      city: 'New York',
      state: 'NY',
      zipCode: '10001',
      country: 'USA'
    }
  },
  {
    id: 'stmt-002',
    statementNumber: 'STMT-2024-002',
    period: '2024-01',
    consumer: 'Design Studio LLC',
    consumerId: 'design-studio',
    agreementName: 'Adobe Creative Cloud Business',
    agreementId: 'agr-002',
    totalAmount: 4500,
    currency: 'USD',
    lineItemCount: 8,
    status: 'imported',
    dueDate: '2024-02-15',
    createdAt: '2024-01-15T10:00:00Z',
    importedAt: '2024-01-20T14:30:00Z',
    subtotal: 4200,
    taxAmount: 300,
    description: 'Adobe Creative Cloud annual subscription for design team',
    billingAddress: {
      company: 'Design Studio LLC',
      street: '456 Creative St',
      city: 'San Francisco',
      state: 'CA',
      zipCode: '94102',
      country: 'USA'
    }
  },
  {
    id: 'stmt-003',
    statementNumber: 'STMT-2024-003',
    period: '2024-02',
    consumer: 'Tech Innovations Inc',
    consumerId: 'tech-innovations',
    agreementName: 'Salesforce Professional',
    agreementId: 'agr-003',
    totalAmount: 7500,
    currency: 'USD',
    lineItemCount: 12,
    status: 'draft',
    dueDate: '2024-03-15',
    createdAt: '2024-02-15T10:00:00Z',
    importedAt: null,
    subtotal: 7000,
    taxAmount: 500,
    description: 'Salesforce Professional CRM monthly fees for February 2024',
    billingAddress: {
      company: 'Tech Innovations Inc',
      street: '789 Tech Blvd',
      city: 'Austin',
      state: 'TX',
      zipCode: '73301',
      country: 'USA'
    }
  },
  {
    id: 'stmt-004',
    statementNumber: 'STMT-2024-004',
    period: '2024-02',
    consumer: 'CloudFirst Solutions',
    consumerId: 'cloudfirst',
    agreementName: 'AWS Enterprise Support',
    agreementId: 'agr-004',
    totalAmount: 20000,
    currency: 'USD',
    lineItemCount: 25,
    status: 'finalized',
    dueDate: '2024-03-15',
    createdAt: '2024-02-15T10:00:00Z',
    importedAt: null,
    subtotal: 18500,
    taxAmount: 1500,
    description: 'AWS Enterprise Support and cloud infrastructure costs for February 2024',
    billingAddress: {
      company: 'CloudFirst Solutions',
      street: '321 Cloud Way',
      city: 'Seattle',
      state: 'WA',
      zipCode: '98101',
      country: 'USA'
    }
  }
];

export async function GET(
  request: NextRequest,
  { params }: { params: { extensionId: string; id: string } }
) {
  try {
    const { extensionId, id } = params;
    
    console.log(`[Statement Detail API] Extension ID: ${extensionId}, Statement ID: ${id}`);
    
    // Find the statement by ID
    const statement = dummyStatements.find(stmt => stmt.id === id);
    
    if (!statement) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Statement not found' 
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: statement,
      meta: {
        extensionId
      }
    });
  } catch (error) {
    console.error('Error fetching statement:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch statement' 
      },
      { status: 500 }
    );
  }
}