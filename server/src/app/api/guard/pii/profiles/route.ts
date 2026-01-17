import { NextRequest, NextResponse } from 'next/server';
import {
  getPiiProfiles,
  createPiiProfile,
} from '@/lib/actions/guard-actions/piiProfileActions';
import { IGuardPiiProfileListParams, ICreatePiiProfileRequest } from '@/interfaces/guard/pii.interfaces';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    const params: IGuardPiiProfileListParams = {
      page: searchParams.get('page') ? parseInt(searchParams.get('page')!, 10) : undefined,
      page_size: searchParams.get('page_size') ? parseInt(searchParams.get('page_size')!, 10) : undefined,
      sort_by: searchParams.get('sort_by') || undefined,
      sort_order: (searchParams.get('sort_order') as 'asc' | 'desc') || undefined,
      enabled: searchParams.get('enabled') !== null ? searchParams.get('enabled') === 'true' : undefined,
      search: searchParams.get('search') || undefined,
    };

    const profiles = await getPiiProfiles(params);
    return NextResponse.json(profiles);
  } catch (error) {
    console.error('Error fetching PII profiles:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch PII profiles' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: ICreatePiiProfileRequest = await request.json();
    const profile = await createPiiProfile(body);
    return NextResponse.json(profile, { status: 201 });
  } catch (error) {
    console.error('Error creating PII profile:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create PII profile' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}
