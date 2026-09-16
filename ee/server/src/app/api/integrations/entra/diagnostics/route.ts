import { NextResponse } from 'next/server';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { badRequest, dynamic, ok, runtime } from '../_responses';
import { requireEntraAccess } from '../_guards';
import { runEntraConnectionDiagnostics } from '@ee/lib/integrations/entra/diagnostics';
import { evaluateEntraReadiness } from '@ee/lib/integrations/entra/diagnostics/readiness';

export { dynamic, runtime };

export async function GET(request: Request): Promise<Response> {
  const accessGate = await requireEntraAccess('read');
  if (accessGate instanceof Response) {
    // Preserve the guard's denial but add structured readiness evidence so the
    // action/UI can explain the precise cause instead of a bare denial.
    const user = await getCurrentUser().catch(() => null);
    const readiness = user
      ? await evaluateEntraReadiness(user).catch(() => null)
      : null;
    const body = (await accessGate.clone().json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    return NextResponse.json(
      { ...(body ?? { success: false, error: 'Forbidden' }), readiness },
      { status: accessGate.status }
    );
  }

  const includeIdentifiers =
    new URL(request.url).searchParams.get('includeIdentifiers') === 'true';

  const readiness = await evaluateEntraReadiness(accessGate.user);

  try {
    const report = await runEntraConnectionDiagnostics(accessGate.tenantId, {
      includeIdentifiers,
      readiness,
    });
    return ok(report);
  } catch (error) {
    console.error('[integrations/entra/diagnostics] Connection diagnostics failed', error);
    return badRequest('Entra connection diagnostics could not be completed.');
  }
}
