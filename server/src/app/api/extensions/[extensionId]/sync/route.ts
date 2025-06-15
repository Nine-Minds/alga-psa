import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  request: NextRequest,
  { params }: { params: { extensionId: string } }
) {
  try {
    const { extensionId } = params;
    const body = await request.json();
    const { syncAgreements = false, syncStatements = false } = body;

    console.log(`[Sync API] Extension ID: ${extensionId}`, { syncAgreements, syncStatements });

    // Simulate sync operation
    let agreementsCount = 0;
    let statementsCount = 0;

    if (syncAgreements) {
      // In a real implementation, this would:
      // 1. Connect to SoftwareOne API based on extension config
      // 2. Fetch latest agreements
      // 3. Update local database
      // 4. Return actual count
      agreementsCount = 5; // Dummy count matching our sample data
    }

    if (syncStatements) {
      // In a real implementation, this would:
      // 1. Connect to SoftwareOne API based on extension config
      // 2. Fetch latest statements
      // 3. Update local database
      // 4. Return actual count
      statementsCount = 4; // Dummy count matching our sample data
    }

    // Simulate some processing time
    await new Promise(resolve => setTimeout(resolve, 500));

    return NextResponse.json({
      success: true,
      message: 'Sync completed successfully',
      data: {
        agreementsCount,
        statementsCount,
        syncedAt: new Date().toISOString(),
        extensionId
      }
    });
  } catch (error) {
    console.error('Error in sync operation:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to sync data' 
      },
      { status: 500 }
    );
  }
}