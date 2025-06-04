import { NextRequest } from 'next/server';
import { proxyRequest } from '../proxy-utils';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const jsonpath = searchParams.get('jsonpath');
  const endpoint = `/api/ui-state${jsonpath ? `?jsonpath=${encodeURIComponent(jsonpath)}` : ''}`;
  
  console.log('[PROXY-UI-STATE] JSONPath:', jsonpath);
  
  return proxyRequest(req, {
    method: 'GET',
    logPrefix: 'PROXY-UI-STATE',
    endpoint
  });
}