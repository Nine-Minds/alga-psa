import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { options } from '../../../api/auth/[...nextauth]/options';
import { featureFlags } from '../../../../lib/feature-flags/featureFlags';
import { z } from 'zod';

// Schema for feature flag request
const featureFlagRequestSchema = z.object({
  flags: z.array(z.string()).optional(),
  context: z.object({
    userRole: z.string().optional(),
    companySize: z.enum(['small', 'medium', 'large', 'enterprise']).optional(),
    subscriptionPlan: z.string().optional(),
    customProperties: z.record(z.any()).optional(),
  }).optional(),
});

/**
 * GET /api/v1/feature-flags
 * Get feature flags for the current user
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(options);
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const flagsParam = searchParams.get('flags');
    const flags = flagsParam ? flagsParam.split(',') : undefined;

    const context = {
      userId: session.user.id,
      tenantId: session.user.tenant,
      deploymentType: process.env.DEPLOYMENT_TYPE as 'hosted' | 'on-premise',
      userRole: session.user.user_type,
    };

    if (flags && flags.length > 0) {
      // Get specific flags
      const results: Record<string, boolean | string> = {};
      
      await Promise.all(
        flags.map(async (flag) => {
          const isEnabled = await featureFlags.isEnabled(flag, context);
          const variant = await featureFlags.getVariant(flag, context);
          results[flag] = variant || isEnabled;
        })
      );

      return NextResponse.json({
        flags: results,
        context: {
          userId: context.userId,
          deployment: context.deploymentType,
        },
      });
    } else {
      // Get all flags
      const allFlags = await featureFlags.getAllFlags(context);
      
      return NextResponse.json({
        flags: allFlags,
        context: {
          userId: context.userId,
          deployment: context.deploymentType,
        },
      });
    }
  } catch (error) {
    console.error('Error fetching feature flags:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/v1/feature-flags
 * Check feature flags with custom context
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(options);
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validatedData = featureFlagRequestSchema.parse(body);

    const context = {
      userId: session.user.id,
      tenantId: session.user.tenant,
      deploymentType: process.env.DEPLOYMENT_TYPE as 'hosted' | 'on-premise',
      userRole: validatedData.context?.userRole || session.user.user_type,
      companySize: validatedData.context?.companySize,
      subscriptionPlan: validatedData.context?.subscriptionPlan,
      customProperties: validatedData.context?.customProperties,
    };

    if (validatedData.flags && validatedData.flags.length > 0) {
      // Check specific flags
      const results: Record<string, boolean | string> = {};
      
      await Promise.all(
        validatedData.flags.map(async (flag) => {
          const isEnabled = await featureFlags.isEnabled(flag, context);
          const variant = await featureFlags.getVariant(flag, context);
          results[flag] = variant || isEnabled;
        })
      );

      return NextResponse.json({
        flags: results,
        context: {
          userId: context.userId,
          deployment: context.deploymentType,
        },
      });
    } else {
      // Get all flags with custom context
      const allFlags = await featureFlags.getAllFlags(context);
      
      return NextResponse.json({
        flags: allFlags,
        context: {
          userId: context.userId,
          deployment: context.deploymentType,
        },
      });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Error checking feature flags:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}