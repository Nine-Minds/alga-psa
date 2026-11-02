/**
 * What the trusted-IdP form tells an admin to enter as the audience, per provider.
 *
 * The audience is the `aud` claim the provider puts in agent tokens; the server
 * only accepts tokens whose `aud` matches it exactly. What that value looks like
 * depends on the provider:
 *
 * - Microsoft Entra (v2.0 issuer): v2 access tokens always carry the resource
 *   app's Application (client) ID GUID as `aud`, even when the agent requested
 *   the scope via the App ID URI (`api://…/.default`).
 * - Google: service-account ID tokens carry whatever `audience` the agent asked
 *   for, so we suggest (and pre-fill) this server's canonical MCP resource URL.
 * - Custom: the API/resource identifier configured in the provider.
 */

export type IdpKind = 'microsoft' | 'google' | 'custom';

export interface AudienceGuide {
  placeholder: string;
  /** Value to pre-fill when the admin picks this provider ('' = no pre-fill). */
  suggested: string;
  helpKey: string;
  helpDefault: string;
}

export function audienceGuide(kind: string, mcpResource: string): AudienceGuide {
  if (kind === 'microsoft') {
    return {
      placeholder: 'e.g. 00000000-0000-0000-0000-000000000000',
      suggested: '',
      helpKey: 'mcpServer.providers.fields.audienceHelp.microsoft',
      helpDefault:
        "The Application (client) ID of the Entra app registration your agents request tokens for. Agents request the scope api://<that ID>/.default.",
    };
  }
  if (kind === 'google') {
    return {
      placeholder: mcpResource,
      suggested: mcpResource,
      helpKey: 'mcpServer.providers.fields.audienceHelp.google',
      helpDefault:
        "Agents must request their Google ID token with exactly this audience. We've filled in this server's MCP URL, which is the usual choice.",
    };
  }
  return {
    placeholder: mcpResource,
    suggested: '',
    helpKey: 'mcpServer.providers.fields.audienceHelp.custom',
    helpDefault:
      "The API or resource identifier set up in your provider (for example, an Auth0 API identifier). It must exactly match the aud claim in agent tokens. This server's MCP URL is a good choice.",
  };
}

/**
 * Switch the form to another provider. An audience the admin typed is kept; one
 * we pre-filled for the previous provider is replaced by the new provider's
 * suggestion, so a Google default never lingers into an Entra registration.
 */
export function withIdpKind<F extends { kind: string; audience: string }>(
  form: F,
  kind: string,
  mcpResource: string,
): F {
  const previous = audienceGuide(form.kind, mcpResource).suggested;
  const untouched = form.audience.trim() === '' || (previous !== '' && form.audience === previous);
  return {
    ...form,
    kind,
    audience: untouched ? audienceGuide(kind, mcpResource).suggested : form.audience,
  };
}
