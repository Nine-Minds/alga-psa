import { NextRequest, NextResponse } from 'next/server';

// Dummy statements data for development
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
    importedAt: null
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
    importedAt: '2024-01-20T14:30:00Z'
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
    importedAt: null
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
    importedAt: null
  }
];

export async function GET(request: NextRequest) {
  try {
    // In a real implementation, this would:
    // 1. Validate user permissions
    // 2. Get tenant context
    // 3. Fetch statements from SoftwareOne API
    // 4. Apply filtering, sorting, pagination
    
    // For now, return dummy data
    return NextResponse.json({
      success: true,
      data: dummyStatements,
      meta: {
        total: dummyStatements.length,
        page: 1,
        pageSize: 50
      }
    });
  } catch (error) {
    console.error('Error fetching statements:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch statements' 
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
      message: 'Statements synced successfully',
      count: dummyStatements.length
    });
  } catch (error) {
    console.error('Error syncing statements:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to sync statements' 
      },
      { status: 500 }
    );
  }
}