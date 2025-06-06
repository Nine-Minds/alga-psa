import { NextRequest } from 'next/server';
import { proxyRequest } from '../../proxy-utils';

export async function POST(req: NextRequest) {
  return proxyRequest(req, {
    method: 'POST',
    logPrefix: 'PROXY-BROWSER-POP-IN',
    endpoint: '/api/browser/pop-in'
  });
}