import { NextRequest, NextResponse } from 'next/server';
import { getAllClients } from '@/lib/actions/client-actions/clientActions';

export async function GET(request: NextRequest) {
  try {
    const clients = await getAllClients();
    return NextResponse.json(clients);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch clients' },
      { status: 500 }
    );
  }
}
