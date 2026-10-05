import { NextRequest, NextResponse } from 'next/server';
import { TenantService, TenantProvisioningError } from '../../../../services/provisioning';
import { CreateTenantSchema } from '../../../../services/provisioning/types/tenant.schema';
import { ZodError } from 'zod';
import { assertMasterTenantAccess, MASTER_TENANT_ERRORS, isMasterTenantAuthError } from '@ee/lib/auth/masterTenantAccess';

export async function POST(req: NextRequest) {
  try {
    // Provisioning a tenant is a platform-operator action: master tenant + system_settings:update.
    await assertMasterTenantAccess(req);

    const body = await req.json();
    const validatedData = CreateTenantSchema.parse(body);
    const tenant = await TenantService.createTenant(validatedData);
    
    return NextResponse.json(tenant, { status: 201 });
  } catch (error) {
    if (isMasterTenantAuthError(error)) {
      const unauthenticated = (error as Error).message === MASTER_TENANT_ERRORS.unauthenticated;
      return NextResponse.json(
        { error: unauthenticated ? 'Unauthorized' : 'Insufficient permissions' },
        { status: unauthenticated ? 401 : 403 }
      );
    }

    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    if (error instanceof TenantProvisioningError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    console.error('Error creating tenant:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
