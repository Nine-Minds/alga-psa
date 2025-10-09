import { NextRequest, NextResponse } from 'next/server';
import { TenantService, TenantProvisioningError } from '../../../../services/provisioning';
import { CreateTenantSchema } from '../../../../services/provisioning/types/tenant.schema';
import { ZodError } from 'zod';
import { getServerSession } from '@/lib/auth-compat';
import { hasPermission } from '@/lib/auth/rbac';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';

export async function POST(req: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get full user details
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 401 }
      );
    }

    // Check authorization
    const canProvisionTenants = await hasPermission(currentUser, 'tenant', 'create');
    if (!canProvisionTenants) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const body = await req.json();
    const validatedData = CreateTenantSchema.parse(body);
    const tenant = await TenantService.createTenant(validatedData);
    
    return NextResponse.json(tenant, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    if (error instanceof TenantProvisioningError) {
      return NextResponse.json(
        { error: error.message, details: error.details },
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
