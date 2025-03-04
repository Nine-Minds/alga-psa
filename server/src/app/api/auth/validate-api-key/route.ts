import { ApiKeyService } from 'server/src/lib/services/apiKeyService';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key');
  
  if (!apiKey) {
    return NextResponse.json(
      { error: 'API key missing' },
      { status: 401 }
    );
  }

  try {
    const keyRecord = await ApiKeyService.validateApiKey(apiKey);
    
    if (!keyRecord) {
      return NextResponse.json(
        { error: 'Invalid API key' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      isValid: true,
      userId: keyRecord.user_id,
      tenant: keyRecord.tenant
    });
  } catch (error) {
    console.error('API key validation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}