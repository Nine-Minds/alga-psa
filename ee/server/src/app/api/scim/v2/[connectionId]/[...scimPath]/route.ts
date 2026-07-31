import {
  handleScimDelete,
  handleScimGet,
  handleScimOptions,
  handleScimPatch,
  handleScimPost,
  handleScimPut,
} from '@ee/lib/scim/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = {
  params: Promise<{
    connectionId: string;
    scimPath: string[];
  }>;
};

export async function GET(request: Request, context: Context): Promise<Response> {
  return handleScimGet(request, await context.params);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  return handleScimPost(request, await context.params);
}

export async function PUT(request: Request, context: Context): Promise<Response> {
  return handleScimPut(request, await context.params);
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  return handleScimPatch(request, await context.params);
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  return handleScimDelete(request, await context.params);
}

export function OPTIONS(): Response {
  return handleScimOptions();
}
