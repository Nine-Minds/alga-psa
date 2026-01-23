import { NextRequest, NextResponse } from 'next/server'

import { handleInternalInvoicingInstallRequest } from '@ee/lib/extensions/invoicingInternalApi'

export const dynamic = 'force-dynamic'

type RouteParams = { installId: string }

async function resolveParams(params: RouteParams | Promise<RouteParams>): Promise<RouteParams> {
  return await Promise.resolve(params)
}

export async function POST(req: NextRequest, { params }: { params: RouteParams | Promise<RouteParams> }) {
  const { installId } = await resolveParams(params)
  const body = await req.json().catch(() => undefined)
  const result = await handleInternalInvoicingInstallRequest({
    installId,
    headers: req.headers,
    body,
  })
  return NextResponse.json(result.body, { status: result.status })
}
