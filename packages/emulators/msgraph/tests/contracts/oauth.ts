import { z } from 'zod';

// Independent Microsoft token-response reference, reviewed 2026-09-08:
// https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow#successful-response-1
// Access tokens are opaque here; this does not validate Entra JWTs or SSO.
export const oauthTokenResponse = z.object({
  access_token: z.string().min(1),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int().positive(),
  scope: z.string().optional(),
  refresh_token: z.string().min(1).optional(),
  id_token: z.string().min(1).optional(),
});
