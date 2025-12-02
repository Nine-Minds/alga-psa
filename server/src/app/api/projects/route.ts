import { NextRequest, NextResponse } from 'next/server';
import { getProjects } from '@/lib/actions/project-actions/projectActions';

export async function GET(request: NextRequest) {
  try {
    const projects = await getProjects();
    return NextResponse.json(projects);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}
