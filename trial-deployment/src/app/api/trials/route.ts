import { NextRequest, NextResponse } from 'next/server';
import { provisionTrial } from '@/lib/trial-manager';
import { trialStore } from '@/lib/trial-store';

const MAX_ACTIVE_TRIALS_PER_EMAIL = 1;
const MAX_TOTAL_ACTIVE_TRIALS = 20;

/**
 * POST /api/trials — Request a new trial instance.
 *
 * Body: { name: string, email: string, company?: string }
 * Returns: { id: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, email, company } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
    }

    // Rate-limit: one active trial per email
    const existingForEmail = trialStore
      .getByEmail(email.trim().toLowerCase())
      .filter(t => !['failed', 'expired', 'destroying'].includes(t.status));

    if (existingForEmail.length >= MAX_ACTIVE_TRIALS_PER_EMAIL) {
      return NextResponse.json(
        {
          error: 'You already have an active trial. Please wait for it to expire or contact support.',
          existingTrialId: existingForEmail[0].id,
        },
        { status: 409 }
      );
    }

    // Global cap
    const allActive = trialStore
      .getAll()
      .filter(t => !['failed', 'expired', 'destroying'].includes(t.status));

    if (allActive.length >= MAX_TOTAL_ACTIVE_TRIALS) {
      return NextResponse.json(
        { error: 'Trial capacity is currently full. Please try again later.' },
        { status: 503 }
      );
    }

    const id = await provisionTrial({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      company: company?.trim() || undefined,
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    console.error('POST /api/trials error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/trials — List all active trials (admin use).
 */
export async function GET() {
  const trials = trialStore.getAll();
  return NextResponse.json({ trials, count: trials.length });
}
