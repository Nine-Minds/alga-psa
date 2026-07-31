import { NextRequest, NextResponse } from 'next/server';
import { applyTemplate } from '@alga-psa/projects/actions/projectTemplateActions';
import { isTemplateActionError, templateErrorResponse } from '../../templateRouteErrors';

export async function POST(
  request: NextRequest,
  { params }: { params: { templateId: string } }
) {
  try {
    let body: {
      project_name?: unknown;
      client_id?: unknown;
      start_date?: unknown;
      assigned_to?: unknown;
      options?: unknown;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    }
    const { project_name, client_id, start_date, assigned_to, options } = body;

    if (typeof project_name !== 'string' || !project_name.trim() || typeof client_id !== 'string' || !client_id.trim()) {
      return NextResponse.json(
        { error: 'Project name and client ID are required' },
        { status: 400 }
      );
    }

    const projectId = await applyTemplate(params.templateId, {
      project_name,
      client_id,
      start_date: typeof start_date === 'string' ? start_date : undefined,
      assigned_to: typeof assigned_to === 'string' ? assigned_to : undefined,
      options: options && typeof options === 'object' ? options as any : undefined
    });
    if (isTemplateActionError(projectId)) {
      return templateErrorResponse(projectId, 'Failed to apply template');
    }

    return NextResponse.json({ project_id: projectId }, { status: 201 });
  } catch (error) {
    console.error('[applyTemplate API] Error:', error);
    return templateErrorResponse(error, 'Failed to apply template');
  }
}
