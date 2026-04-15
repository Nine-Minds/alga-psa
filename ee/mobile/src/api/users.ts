import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import type { PaginatedResponse } from "./tickets";

export type UserListItem = {
  user_id: string;
  username: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  image: string | null;
  avatarUrl: string | null;
  is_inactive: boolean;
};

export function listUsers(
  client: ApiClient,
  params: {
    apiKey: string;
    search?: string;
    limit?: number;
    signal?: AbortSignal;
  },
): Promise<ApiResult<PaginatedResponse<UserListItem>>> {
  if (params.search) {
    return client.request<PaginatedResponse<UserListItem>>({
      method: "GET",
      path: "/api/v1/users/search",
      query: {
        query: params.search,
        fields: "first_name,last_name,email,username",
        user_type: "internal",
        include_inactive: "false",
        limit: params.limit ?? 25,
      },
      headers: { "x-api-key": params.apiKey },
      signal: params.signal,
    });
  }

  return client.request<PaginatedResponse<UserListItem>>({
    method: "GET",
    path: "/api/v1/users",
    query: {
      user_type: "internal",
      is_inactive: "false",
      limit: params.limit ?? 25,
      sort: "first_name",
      order: "asc",
    },
    headers: { "x-api-key": params.apiKey },
    signal: params.signal,
  });
}

export function getUserDisplayName(user: UserListItem): string {
  if (user.first_name && user.last_name) return `${user.first_name} ${user.last_name}`;
  if (user.first_name) return user.first_name;
  if (user.last_name) return user.last_name;
  return user.username;
}
