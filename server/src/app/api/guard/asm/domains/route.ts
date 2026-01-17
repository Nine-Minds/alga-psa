import { NextRequest, NextResponse } from 'next/server';
import {
  getAsmDomains,
  createAsmDomain,
} from '@/lib/actions/guard-actions/asmDomainActions';
import { IGuardAsmDomainListParams, ICreateAsmDomainRequest } from '@/interfaces/guard/asm.interfaces';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    const params: IGuardAsmDomainListParams = {
      page: searchParams.get('page') ? parseInt(searchParams.get('page')!, 10) : undefined,
      page_size: searchParams.get('page_size') ? parseInt(searchParams.get('page_size')!, 10) : undefined,
      sort_by: searchParams.get('sort_by') || undefined,
      sort_order: (searchParams.get('sort_order') as 'asc' | 'desc') || undefined,
      company_id: searchParams.get('company_id') || undefined,
      enabled: searchParams.get('enabled') !== null ? searchParams.get('enabled') === 'true' : undefined,
      search: searchParams.get('search') || undefined,
    };

    const domains = await getAsmDomains(params);
    return NextResponse.json(domains);
  } catch (error) {
    console.error('Error fetching ASM domains:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch ASM domains' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: ICreateAsmDomainRequest = await request.json();
    const domain = await createAsmDomain(body);
    return NextResponse.json(domain, { status: 201 });
  } catch (error) {
    console.error('Error creating ASM domain:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create ASM domain' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}
