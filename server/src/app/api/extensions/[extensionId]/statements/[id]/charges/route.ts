import { NextRequest, NextResponse } from 'next/server';

// Dummy charges data for each statement
const dummyCharges: Record<string, any[]> = {
  'stmt-001': [
    {
      id: '1-1',
      statementId: 'stmt-001',
      description: 'Microsoft 365 E3 - Monthly subscription',
      product: 'Microsoft 365 E3',
      quantity: 50,
      unitPrice: 35,
      totalAmount: 1750,
      agreementId: 'agr-001',
      period: '2024-01',
      category: 'Software License'
    },
    {
      id: '1-2',
      statementId: 'stmt-001',
      description: 'Microsoft 365 E3 - Additional users',
      product: 'Microsoft 365 E3',
      quantity: 25,
      unitPrice: 35,
      totalAmount: 875,
      agreementId: 'agr-001',
      period: '2024-01',
      category: 'Software License'
    },
    {
      id: '1-3',
      statementId: 'stmt-001',
      description: 'Exchange Online Archiving',
      product: 'Exchange Online Archiving',
      quantity: 75,
      unitPrice: 8,
      totalAmount: 600,
      agreementId: 'agr-001',
      period: '2024-01',
      category: 'Add-on Service'
    },
    {
      id: '1-4',
      statementId: 'stmt-001',
      description: 'Power BI Pro',
      product: 'Power BI Pro',
      quantity: 15,
      unitPrice: 12,
      totalAmount: 180,
      agreementId: 'agr-001',
      period: '2024-01',
      category: 'Analytics'
    }
  ],
  'stmt-002': [
    {
      id: '2-1',
      statementId: 'stmt-002',
      description: 'Adobe Creative Cloud All Apps',
      product: 'Creative Cloud All Apps',
      quantity: 15,
      unitPrice: 280,
      totalAmount: 4200,
      agreementId: 'agr-002',
      period: '2024-01',
      category: 'Creative Software'
    }
  ],
  'stmt-003': [
    {
      id: '3-1',
      statementId: 'stmt-003',
      description: 'Salesforce Professional Edition',
      product: 'Salesforce Professional',
      quantity: 50,
      unitPrice: 120,
      totalAmount: 6000,
      agreementId: 'agr-003',
      period: '2024-02',
      category: 'CRM Platform'
    },
    {
      id: '3-2',
      statementId: 'stmt-003',
      description: 'Salesforce Data Storage (Additional 100GB)',
      product: 'Salesforce Storage',
      quantity: 10,
      unitPrice: 100,
      totalAmount: 1000,
      agreementId: 'agr-003',
      period: '2024-02',
      category: 'Storage'
    }
  ],
  'stmt-004': [
    {
      id: '4-1',
      statementId: 'stmt-004',
      description: 'AWS Enterprise Support',
      product: 'AWS Enterprise Support',
      quantity: 1,
      unitPrice: 15000,
      totalAmount: 15000,
      agreementId: 'agr-004',
      period: '2024-02',
      category: 'Support Service'
    },
    {
      id: '4-2',
      statementId: 'stmt-004',
      description: 'AWS EC2 Compute Hours',
      product: 'AWS EC2',
      quantity: 1000,
      unitPrice: 2.5,
      totalAmount: 2500,
      agreementId: 'agr-004',
      period: '2024-02',
      category: 'Compute'
    },
    {
      id: '4-3',
      statementId: 'stmt-004',
      description: 'AWS S3 Storage',
      product: 'AWS S3',
      quantity: 500,
      unitPrice: 2,
      totalAmount: 1000,
      agreementId: 'agr-004',
      period: '2024-02',
      category: 'Storage'
    }
  ]
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ extensionId: string; id: string }> }
) {
  try {
    const resolvedParams = await params;
  const { extensionId, id } = resolvedParams;
    
    console.log(`[Statement Charges API] Extension ID: ${extensionId}, Statement ID: ${id}`);
    
    // Get charges for the statement
    const charges = dummyCharges[id] || [];

    return NextResponse.json({
      success: true,
      data: charges,
      meta: {
        total: charges.length,
        statementId: id,
        extensionId
      }
    });
  } catch (error) {
    console.error('Error fetching statement charges:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch statement charges' 
      },
      { status: 500 }
    );
  }
}