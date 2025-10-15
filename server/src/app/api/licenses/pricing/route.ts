import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/licenses/pricing
 * Get license pricing information
 *
 * Returns:
 * - Success: { success: true, data: { priceId, unitAmount, currency, interval } }
 * - Error: { success: false, error: string }
 */
export async function GET(req: NextRequest) {
  try {
    const licensePriceId = process.env.STRIPE_LICENSE_PRICE_ID;

    if (!licensePriceId) {
      return NextResponse.json(
        { success: false, error: 'License pricing not configured' },
        { status: 500 }
      );
    }

    // Get pricing from environment variables
    const unitAmountCents = parseInt(process.env.STRIPE_LICENSE_UNIT_AMOUNT || '5000', 10);
    const currency = process.env.STRIPE_LICENSE_CURRENCY || 'usd';
    const interval = process.env.STRIPE_LICENSE_INTERVAL || 'month';

    return NextResponse.json({
      success: true,
      data: {
        priceId: licensePriceId,
        unitAmount: unitAmountCents,
        currency,
        interval,
      },
    });
  } catch (error) {
    console.error('[GET /api/licenses/pricing] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
