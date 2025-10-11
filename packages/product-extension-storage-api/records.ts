import * as oss from './oss/records';

const isEnterprise = () => process.env.EDITION === 'ee' || process.env.NEXT_PUBLIC_EDITION === 'enterprise';

export const dynamic = 'force-dynamic';

async function loadEeModule() {
  return import('./ee/records-impl');
}

export async function GET(req: any, ctx: any) {
  if (isEnterprise()) {
    const mod = await loadEeModule();
    return mod.GET(req, ctx);
  }
  return oss.GET(req, ctx);
}

export async function POST(req: any, ctx: any) {
  if (isEnterprise()) {
    const mod = await loadEeModule();
    return mod.POST(req, ctx);
  }
  return oss.POST(req, ctx);
}
