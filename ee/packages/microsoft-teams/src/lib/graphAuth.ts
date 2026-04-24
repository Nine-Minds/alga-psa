function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function fetchMicrosoftGraphAppToken(params: {
  tenantAuthority: string;
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  const tokenResponse = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(params.tenantAuthority)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: params.clientId,
        client_secret: params.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    }
  );

  if (!tokenResponse.ok) {
    const errorBody = await tokenResponse.text();
    throw new Error(
      `Failed to acquire Teams Graph token (${tokenResponse.status}): ${errorBody || tokenResponse.statusText}`
    );
  }

  const tokenPayload = (await tokenResponse.json()) as { access_token?: string };
  const accessToken = normalizeString(tokenPayload.access_token);

  if (!accessToken) {
    throw new Error('Microsoft token response did not include an access token.');
  }

  return accessToken;
}
