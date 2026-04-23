import type { AuthorizationScope } from './contracts';

export const ALLOW_ALL_SCOPE: AuthorizationScope = {
  allowAll: true,
  denied: false,
  constraints: [],
};

export const DENY_ALL_SCOPE: AuthorizationScope = {
  allowAll: false,
  denied: true,
  constraints: [],
};

export function intersectAuthorizationScopes(...scopes: AuthorizationScope[]): AuthorizationScope {
  if (scopes.length === 0) {
    return ALLOW_ALL_SCOPE;
  }

  if (scopes.some((scope) => scope.denied)) {
    return DENY_ALL_SCOPE;
  }

  const constraints = scopes.flatMap((scope) => scope.constraints ?? []);

  return {
    allowAll: false,
    denied: false,
    constraints,
  };
}
