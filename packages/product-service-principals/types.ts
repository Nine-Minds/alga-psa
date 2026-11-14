// Edition-neutral contract of the service-principal boundary. These shapes are
// shared by the CE stub and the EE implementation; they carry no behavior.

export interface BoundaryApiKeyRecord {
  user_id: string;
  tenant: string;
  api_key_id?: string;
  agent_id?: string | null;
}

export interface BoundaryOwner {
  user_id?: string;
  user_type?: string | null;
}

/** Subject that the API call is made as (key owner by default). */
export interface BoundaryPrincipal {
  userId: string;
  userType: string;
  kind: 'user' | 'service';
}

/** Per-context token-bucket override. */
export interface BoundaryRateLimitConfig {
  maxTokens: number;
  refillRate: number;
}

/**
 * API context produced by the boundary. Structurally compatible with the
 * server's AuthenticatedApiContext; `TUser` is the server's SafeApiUser.
 */
export interface BoundaryApiContext<TUser = unknown> {
  userId: string;
  tenant: string;
  apiKeyId?: string;
  user: TUser;
  kind?: 'user';
  principal: BoundaryPrincipal;
  actAsUserId?: string | null;
  effectiveUserId: string;
  viaPrincipalUserId?: string | null;
  rateLimitSubjectId?: string;
  rateLimitConfig?: BoundaryRateLimitConfig;
}

/** The owner of an API key as seen by the key gate. */
export interface BoundaryKeyGateOwner {
  user_id: string;
  tenant: string;
  user_type?: string | null;
  is_inactive?: boolean | null;
}
