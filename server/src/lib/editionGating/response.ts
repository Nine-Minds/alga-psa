import { NextResponse } from 'next/server';
import {
  createEditionGateResponseBody,
  type EditionGatedFeature,
  type EditionGateResponseBody,
} from './types';

export function editionGateResponse(
  feature: EditionGatedFeature,
  init: Omit<ResponseInit, 'status'> = {},
): NextResponse<EditionGateResponseBody> {
  return NextResponse.json(createEditionGateResponseBody(feature), {
    ...init,
    status: 403,
  });
}

/** Preserve OAuth's registered error fields while adding the shared edition-gate metadata. */
export function editionGateOAuthResponse(
  feature: EditionGatedFeature,
  init: Omit<ResponseInit, 'status'> = {},
): NextResponse {
  const body = createEditionGateResponseBody(feature);
  const { error: _error, ...metadata } = body;

  return NextResponse.json(
    {
      error: 'access_denied',
      error_description: body.message,
      ...metadata,
    },
    {
      ...init,
      status: 403,
    },
  );
}
