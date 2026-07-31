import { NextRequest, NextResponse } from 'next/server';
import { getTeamsAvailability } from './teamsAvailability';
import { resolveTeamsTabAuthState, type TeamsTabAuthState } from './resolveTeamsTabAuthState';
import { buildTeamsReauthUrl } from './buildTeamsReauthUrl';
import { isBotConnectorConfigured, sendBotActivity } from './bot/teamsBotConnector';
import { findTeamsConversationReferenceByConversationId } from './bot/teamsConversationReferences';
import { buildTeamsAdaptiveCard, buildAdaptiveImBackAction } from './bot/teamsAdaptiveCards';

type TeamsAuthCallbackSurface = 'tab' | 'bot' | 'message_extension';

interface TeamsAuthCallbackPayload {
  type: 'teams-auth-callback';
  surface: TeamsAuthCallbackSurface;
  success: boolean;
  status: TeamsTabAuthState['status'] | 'disabled' | 'unavailable';
  tenantId: string | null;
  userId?: string | null;
  userName?: string | null;
  userEmail?: string | null;
  profileId?: string | null;
  microsoftTenantId?: string | null;
  message: string;
}

function getSurfaceLabel(surface: TeamsAuthCallbackSurface): string {
  switch (surface) {
    case 'tab':
      return 'Teams Tab';
    case 'bot':
      return 'Teams Bot';
    case 'message_extension':
      return 'Teams Message Extension';
  }
}

function buildCallbackPayload(
  surface: TeamsAuthCallbackSurface,
  state: Exclude<TeamsTabAuthState, { status: 'unauthenticated' }>
): TeamsAuthCallbackPayload {
  if (state.status === 'ready') {
    return {
      type: 'teams-auth-callback',
      surface,
      success: true,
      status: state.status,
      tenantId: state.tenantId,
      userId: state.userId,
      userName: state.userName,
      userEmail: state.userEmail,
      profileId: state.profileId,
      microsoftTenantId: state.microsoftTenantId,
      message: `${getSurfaceLabel(surface)} sign-in complete.`,
    };
  }

  return {
    type: 'teams-auth-callback',
    surface,
    success: false,
    status: state.status,
    tenantId: 'tenantId' in state ? state.tenantId || null : null,
    message: state.message,
  };
}

function renderCallbackHtml(payload: TeamsAuthCallbackPayload): string {
  const payloadJson = JSON.stringify(payload);
  const encoded = Buffer.from(payloadJson).toString('base64');
  const title = `${getSurfaceLabel(payload.surface)} ${payload.success ? 'Success' : 'Unavailable'}`;

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 24px; color: #111827; }
      .shell { max-width: 640px; margin: 0 auto; }
      .status { color: #4b5563; margin-top: 12px; }
      .details { display: none; margin-top: 16px; padding: 16px; border-radius: 12px; background: #f3f4f6; white-space: pre-wrap; }
      button { margin-top: 16px; }
    </style>
  </head>
  <body>
    <div class="shell">
      <h2>${title}</h2>
      <p class="status" id="status">${payload.success ? 'Finishing sign-in…' : 'Preparing Teams response…'}</p>
      <pre class="details" id="details"></pre>
      <button id="close" onclick="window.close()" style="display:none">Close window</button>
    </div>
    <script id="teams-auth-payload" type="application/json">${payloadJson.replace(/</g, '\\u003c')}</script>
    <script>
      (function () {
        var payload = JSON.parse(atob('${encoded}'));
        try {
          var target = window.opener || window.parent;
          if (target && target !== window) {
            target.postMessage(payload, '*');
          }
        } catch (error) {}
        try {
          window.close();
        } catch (error) {}
        setTimeout(function () {
          if (!window.closed) {
            document.getElementById('status').textContent = payload.message;
            document.getElementById('details').style.display = 'block';
            document.getElementById('details').textContent = JSON.stringify(payload, null, 2);
            document.getElementById('close').style.display = 'inline-block';
          }
        }, 100);
      })();
    </script>
  </body>
</html>`;
}

function getRequestUrl(request: NextRequest | Request): URL {
  return 'nextUrl' in request && request.nextUrl instanceof URL ? request.nextUrl : new URL(request.url);
}

function buildCallbackUrl(request: NextRequest | Request): string {
  const requestUrl = getRequestUrl(request);
  return `${requestUrl.pathname}${requestUrl.search}`;
}

function getExpectedTenantId(request: NextRequest | Request): string | null {
  const requestUrl = getRequestUrl(request);
  return requestUrl.searchParams.get('tenantId') || requestUrl.searchParams.get('tenant');
}

function getExpectedMicrosoftTenantId(request: NextRequest | Request): string | null {
  const requestUrl = getRequestUrl(request);
  return (
    requestUrl.searchParams.get('microsoftTenantId') ||
    requestUrl.searchParams.get('teamsTenantId') ||
    requestUrl.searchParams.get('tid')
  );
}

function getBotConversationId(request: NextRequest | Request): string | null {
  const requestUrl = getRequestUrl(request);
  const conversationId = requestUrl.searchParams.get('conversationId');
  return conversationId && conversationId.trim() ? conversationId.trim() : null;
}

/**
 * After a bot-initiated sign-in completes, confirm in the originating Teams
 * conversation with a proactive welcome card (the sign-in card carried the
 * conversation id through the auth flow). Best-effort: failures never break
 * the callback page.
 */
async function sendTeamsBotWelcomeCard(params: {
  tenantId: string;
  conversationId: string;
  userName: string | null;
}): Promise<void> {
  try {
    if (!isBotConnectorConfigured()) {
      return;
    }

    const reference = await findTeamsConversationReferenceByConversationId({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
    });
    if (!reference || !reference.serviceUrl) {
      return;
    }

    const title = 'You are signed in to Alga PSA';
    const text = `${params.userName ? `${params.userName}, your` : 'Your'} Microsoft account is now linked. Try “my tickets” to see your queue, or “help” for everything the bot can do.`;
    const welcomeActivity = {
      type: 'message' as const,
      text,
      attachments: [
        buildTeamsAdaptiveCard({
          title,
          text,
          actions: [
            buildAdaptiveImBackAction('My tickets', 'my tickets'),
            buildAdaptiveImBackAction('Help', 'help'),
          ],
        }),
      ],
    };

    try {
      await sendBotActivity({
        serviceUrl: reference.serviceUrl,
        conversationId: params.conversationId,
        activity: welcomeActivity,
      });
    } catch {
      // Hero-card fallback for clients that reject adaptive content.
      await sendBotActivity({
        serviceUrl: reference.serviceUrl,
        conversationId: params.conversationId,
        activity: {
          type: 'message',
          text,
          attachments: [
            {
              contentType: 'application/vnd.microsoft.card.hero',
              content: { title, text },
            },
          ],
        },
      });
    }
  } catch (error) {
    console.warn('[teams-auth-callback] failed to send bot welcome card', {
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function buildAvailabilityPayload(
  surface: TeamsAuthCallbackSurface,
  params: {
    tenantId: string | null;
    status: 'disabled' | 'unavailable';
    message: string;
  }
): TeamsAuthCallbackPayload {
  return {
    type: 'teams-auth-callback',
    surface,
    success: false,
    status: params.status,
    tenantId: params.tenantId,
    message: params.message,
  };
}

export async function handleTeamsAuthCallback(
  request: NextRequest | Request,
  surface: TeamsAuthCallbackSurface
): Promise<NextResponse> {
  const expectedTenantId = getExpectedTenantId(request);
  if (expectedTenantId) {
    const availability = await getTeamsAvailability({ tenantId: expectedTenantId });
    if (availability.enabled === false) {
      return new NextResponse(
        renderCallbackHtml(
          buildAvailabilityPayload(surface, {
            tenantId: expectedTenantId,
            status: availability.reason === 'ce_unavailable' ? 'unavailable' : 'disabled',
            message: availability.message,
          })
        ),
        {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        }
      );
    }
  }

  const state = await resolveTeamsTabAuthState({
    expectedTenantId,
    expectedMicrosoftTenantId: getExpectedMicrosoftTenantId(request),
  });

  if (state.status === 'unauthenticated') {
    const requestUrl = getRequestUrl(request);
    return NextResponse.redirect(buildTeamsReauthUrl(requestUrl.origin, buildCallbackUrl(request)));
  }

  const availability = await getTeamsAvailability({
    tenantId: state.tenantId || expectedTenantId || undefined,
    userId: state.status === 'ready' ? state.userId : undefined,
  });
  if (availability.enabled === false) {
    return new NextResponse(
      renderCallbackHtml(
        buildAvailabilityPayload(surface, {
          tenantId: state.tenantId || expectedTenantId || null,
          status: availability.reason === 'ce_unavailable' ? 'unavailable' : 'disabled',
          message: availability.message,
        })
      ),
      {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      }
    );
  }

  const payload = buildCallbackPayload(surface, state);

  if (surface === 'bot' && state.status === 'ready') {
    const conversationId = getBotConversationId(request);
    if (conversationId) {
      await sendTeamsBotWelcomeCard({
        tenantId: state.tenantId,
        conversationId,
        userName: state.userName,
      });
    }
  }

  return new NextResponse(renderCallbackHtml(payload), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
