import { NextRequest, NextResponse } from 'next/server';

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://ai-api:4000';

export interface ProxyOptions {
  method?: string;
  logPrefix: string;
  endpoint: string;
}

export async function proxyRequest(
  req: NextRequest,
  options: ProxyOptions
): Promise<NextResponse> {
  const startTime = Date.now();
  const { method = req.method, logPrefix, endpoint } = options;
  
  console.log(`[${logPrefix}] === Incoming ${method} request ===`);
  console.log(`[${logPrefix}] Path: ${req.url}`);
  console.log(`[${logPrefix}] API_BASE: ${API_BASE}`);
  
  try {
    let body = null;
    if (method === 'POST') {
      body = await req.json();
      console.log(`[${logPrefix}] Request body:`, JSON.stringify(body, null, 2).substring(0, 500));
    }
    
    const targetUrl = `${API_BASE}${endpoint}`;
    console.log(`[${logPrefix}] Proxying to: ${targetUrl}`);
    
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    
    // Forward any auth headers
    const authHeader = req.headers.get('authorization');
    if (authHeader) {
      headers['Authorization'] = authHeader;
      console.log(`[${logPrefix}] Forwarding auth header`);
    }
    
    const fetchOptions: RequestInit = {
      method,
      headers,
    };
    
    if (body) {
      fetchOptions.body = JSON.stringify(body);
    }
    
    console.log(`[${logPrefix}] Fetch options:`, { method, headers: Object.keys(headers) });
    
    const response = await fetch(targetUrl, fetchOptions);
    
    console.log(`[${logPrefix}] Response status: ${response.status}`);
    console.log(`[${logPrefix}] Response headers:`, Object.fromEntries(response.headers.entries()));
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[${logPrefix}] Error response:`, errorText);
      console.log(`[${logPrefix}] Request failed in ${Date.now() - startTime}ms`);
      return NextResponse.json(
        { error: errorText },
        { status: response.status }
      );
    }
    
    const data = await response.json();
    const dataSize = JSON.stringify(data).length;
    console.log(`[${logPrefix}] Success response size: ${dataSize} bytes`);
    if (dataSize < 1000) {
      console.log(`[${logPrefix}] Response data:`, data);
    }
    console.log(`[${logPrefix}] Request completed in ${Date.now() - startTime}ms`);
    
    return NextResponse.json(data);
  } catch (error) {
    console.error(`[${logPrefix}-ERROR] Exception:`, error);
    console.error(`[${logPrefix}-ERROR] Stack:`, error instanceof Error ? error.stack : 'No stack trace');
    console.log(`[${logPrefix}] Request failed with exception in ${Date.now() - startTime}ms`);
    
    // Check for specific error types
    if (error instanceof TypeError && error.message.includes('fetch')) {
      console.error(`[${logPrefix}-ERROR] Network error - cannot reach ${API_BASE}`);
      return NextResponse.json(
        { error: `Network error: Cannot reach backend at ${API_BASE}` },
        { status: 503 }
      );
    }
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}