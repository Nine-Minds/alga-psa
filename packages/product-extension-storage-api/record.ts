import * as oss from './oss/record';

const isEnterprise = () => process.env.EDITION === 'ee' || process.env.NEXT_PUBLIC_EDITION === 'enterprise';

export const dynamic = 'force-dynamic';

async function loadEeModule() {
  return import('./ee/record-impl');
}

export async function GET(req: any, ctx: any) {
  if (isEnterprise()) {
    const mod = await loadEeModule();
    return mod.GET(req, ctx);
  }
  return oss.GET(req, ctx);
}

export async function PUT(req: any, ctx: any) {
  if (isEnterprise()) {
    const mod = await loadEeModule();
    return mod.PUT(req, ctx);
  }
  return oss.PUT(req, ctx);
}

export async function DELETE(req: any, ctx: any) {
  if (isEnterprise()) {
    const mod = await loadEeModule();
    return mod.DELETE(req, ctx);
  }
  return oss.DELETE(req, ctx);
}
