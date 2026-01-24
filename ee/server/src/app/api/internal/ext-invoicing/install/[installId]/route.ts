import { NextRequest, NextResponse } from 'next/server'

import { handleInternalInvoicingInstallRequest } from '@ee/lib/extensions/invoicingInternalApi'
import { resolveInstallIdFromParamsOrUrl } from '@ee/lib/next/routeParams'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params?: unknown }) {
  const installId = await resolveInstallIdFromParamsOrUrl(ctx.params, req.url)
  const body = await req.json().catch(() => undefined)
  const result = await handleInternalInvoicingInstallRequest({
    installId: installId ?? '',
    headers: req.headers,
    body,
  })
  return NextResponse.json(result.body, { status: result.status })
}
