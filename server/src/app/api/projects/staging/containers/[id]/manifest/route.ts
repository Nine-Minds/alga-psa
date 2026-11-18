/**
 * Staging box manifest (session-authenticated; a composition root, alga-2026-0002683 C6)
 * GET /api/projects/staging/containers/[id]/manifest — the packing manifest PDF of one project staging box.
 *
 * Modelled on /api/labels/pdf: it lives under /api (not /api/v1, the API-key namespace), is on the
 * middleware API-key skip-list so the browser session cookie reaches it, and authenticates in-handler
 * with withAuth. It is in the server app because it joins the record owner (projects: data and
 * authorization) with the renderer (billing), which may not import each other.
 *
 * Read-only: nothing is written (the PDF is NOT filed as a document), no event is published.
 * A missing box, a deleted box and a box the caller may not read are the same 404.
 */

import { AuthenticationError, withAuth } from '@alga-psa/auth';
import { renderRegisteredDocumentPdf } from '@alga-psa/billing/services';
import {
  ENGLISH_MANIFEST_TEXT,
  getStagingManifestViewModel,
  type ManifestText,
} from '@alga-psa/projects/lib/stagingManifestViewModelProvider';
import { getServerLocale, getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const NOT_FOUND = () => json(404, { error: 'Not found.' });

async function manifestText(locale: string): Promise<ManifestText> {
  try {
    const { t } = await getServerTranslation(locale as never, 'documents');
    return {
      ownerMsp: t('labels.ownerMsp', { defaultValue: ENGLISH_MANIFEST_TEXT.ownerMsp }),
      ownerClient: t('labels.ownerClient', { defaultValue: ENGLISH_MANIFEST_TEXT.ownerClient }),
      statusOpen: t('labels.statusOpen', { defaultValue: ENGLISH_MANIFEST_TEXT.statusOpen }),
      statusSealed: t('labels.statusSealed', { defaultValue: ENGLISH_MANIFEST_TEXT.statusSealed }),
    };
  } catch {
    return ENGLISH_MANIFEST_TEXT;
  }
}

const renderManifest = withAuth(async (user, { tenant }, containerId: string, baseUrl: string) => {
  // MSP users only; a client-portal user gets the same answer as a missing box.
  if (user.user_type !== 'internal') return null;
  const locale = await getServerLocale().catch(() => 'en');
  const viewModel = await getStagingManifestViewModel(
    { tenant, user, baseUrl, text: await manifestText(locale) },
    containerId,
  );
  if (!viewModel) return null;
  const { pdf } = await renderRegisteredDocumentPdf(tenant, 'staging-manifest', viewModel as unknown as Record<string, unknown>, {
    locale,
    title: `Manifest ${viewModel.box.identifier}`,
  });
  return { pdf, identifier: viewModel.box.identifier };
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NOT_FOUND();
  const baseUrl = process.env.NEXTAUTH_URL;
  if (!baseUrl) return json(500, { error: 'The application URL is not configured.' });
  try {
    const result = await renderManifest(id, baseUrl);
    if (!result) return NOT_FOUND();
    const fileName = result.identifier.replace(/[^A-Za-z0-9._-]+/g, '_');
    return new Response(new Uint8Array(result.pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${fileName}-manifest.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof AuthenticationError) return json(401, { error: 'Not authenticated.' });
    return json(500, { error: 'Failed to generate the manifest.' });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
