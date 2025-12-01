import { NextRequest, NextResponse } from 'next/server';
import { applyTemplate } from '@/lib/actions/project-actions/projectTemplateActions';

export async function POST(
  request: NextRequest,
  { params }: { params: { templateId: string } }
) {
  try {
    const body = await request.json();
    const { project_name, client_id, start_date, assigned_to, options } = body;

    if (!project_name || !client_id) {
      return NextResponse.json(
        { error: 'Project name and client ID are required' },
        { status: 400 }
      );
    }

    const projectId = await applyTemplate(params.templateId, {
      project_name,
      client_id,
      start_date,
      assigned_to,
      options
    });

    return NextResponse.json({ project_id: projectId }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to apply template' },
      { status: 500 }
    );
  }
}
