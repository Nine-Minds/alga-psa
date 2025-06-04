import { NextResponse } from 'next/server';

export async function GET() {
  const config = {
    environment: process.env.NODE_ENV,
    apiBase: process.env.NEXT_PUBLIC_API_URL || 'http://ai-api:4000',
    nodeOptions: process.env.NODE_OPTIONS,
    port: process.env.PORT || 3000,
    hostname: process.env.HOSTNAME || '0.0.0.0',
    timestamp: new Date().toISOString(),
    headers: {
      maxSize: process.env.NODE_OPTIONS?.includes('max-http-header-size') 
        ? process.env.NODE_OPTIONS.match(/--max-http-header-size=(\d+)/)?.[1] 
        : 'default'
    }
  };
  
  console.log('[DEBUG-PROXY-CONFIG] Configuration:', config);
  
  // Try to reach the backend
  let backendStatus = 'unknown';
  try {
    const response = await fetch(`${config.apiBase}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    }).catch(() => null);
    
    if (response) {
      backendStatus = `reachable (status: ${response.status})`;
    } else {
      backendStatus = 'unreachable';
    }
  } catch (error) {
    backendStatus = `error: ${error instanceof Error ? error.message : String(error)}`;
  }
  
  return NextResponse.json({
    ...config,
    backend: {
      url: config.apiBase,
      status: backendStatus
    }
  });
}