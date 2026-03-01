import { NextRequest, NextResponse } from 'next/server';
import { getProjects } from '@alga-psa/projects/actions/projectActions';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

export async function GET(request: NextRequest) {
  try {
    const projects = await getProjects();
    if (isActionPermissionError(projects)) {
      return NextResponse.json({ error: 'forbidden', message: projects.permissionError }, { status: 403 });
    }
    return NextResponse.json(projects);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}
