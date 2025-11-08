import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getInstallConfig } from '@ee/lib/extensions/installConfig';

export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  tenantId: z.string().min(1),
  extensionId: z.string().min(1),
});

function ensureRunnerAuth(req: NextRequest) {
  const token = process.env.RUNNER_CONFIG_API_TOKEN || process.env.RUNNER_STORAGE_API_TOKEN;
  if (!token) {
    throw new Error('runner auth token not configured');
  }
  const provided = req.headers.get('x-runner-auth');
  if (!provided || provided !== token) {
    const err = new Error('unauthorized');
    (err as any).status = 401;
    throw err;
  }
}

export async function POST(req: NextRequest) {
  try {
    ensureRunnerAuth(req);
    const body = requestSchema.parse(await req.json());
    const result = await getInstallConfig({ tenantId: body.tenantId, extensionId: body.extensionId });
    if (!result) {
      return NextResponse.json({ error: 'install_not_found' }, { status: 404 });
    }
    return NextResponse.json(result, { status: 200 });
  } catch (error: any) {
    const status = error?.status === 401 ? 401 : 500;
    if (status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_request', details: error.flatten() }, { status: 400 });
    }
    console.error('[ext-runner/install-config] unexpected', error);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
