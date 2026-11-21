import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import type { SuccessResponse } from "./tickets";
import type { FeatureCapabilities } from "./capabilities";

/** The result types the app can open; the server indexes more. */
export const SEARCHABLE_TYPES = [
  "ticket",
  "client",
  "contact",
  "asset",
  "project",
  "project_task",
] as const;

export type SearchableType = (typeof SEARCHABLE_TYPES)[number];

export type SearchResult = {
  type: string;
  id: string;
  parentId?: string | null;
  title: string;
  subtitle?: string | null;
  snippet?: string | null;
  url?: string | null;
  score?: number;
  updatedAt?: string;
};

export type SearchPayload = {
  results: SearchResult[];
  groups?: Record<string, number>;
  totalCount?: number;
  nextCursor?: string | null;
};

export function search(
  client: ApiClient,
  params: {
    apiKey: string;
    query: string;
    types?: readonly string[];
    limit?: number;
    cursor?: string;
    signal?: AbortSignal;
  },
): Promise<ApiResult<SuccessResponse<SearchPayload>>> {
  return client.request<SuccessResponse<SearchPayload>>({
    method: "GET",
    path: "/api/v1/search",
    signal: params.signal,
    query: {
      query: params.query,
      // The endpoint takes `types` as a comma-separated list.
      types: params.types && params.types.length > 0 ? params.types.join(",") : undefined,
      limit: params.limit,
      cursor: params.cursor,
    },
    headers: { "x-api-key": params.apiKey },
  });
}

export type SearchRoute =
  | { screen: "TicketDetail"; params: { ticketId: string } }
  | { screen: "ClientDetail"; params: { clientId: string; clientName?: string } }
  | { screen: "ContactDetail"; params: { contactId: string; contactName?: string } }
  | { screen: "AssetDetail"; params: { assetId: string; assetName?: string } }
  | { screen: "ProjectDetail"; params: { projectId: string; projectName?: string } }
  | { screen: "ProjectTaskDetail"; params: { taskId: string } };

/** Where a result opens; null for a type this app has no screen for. */
export function routeForResult(result: SearchResult): SearchRoute | null {
  switch (result.type) {
    case "ticket":
      return { screen: "TicketDetail", params: { ticketId: result.id } };
    case "client":
      return { screen: "ClientDetail", params: { clientId: result.id, clientName: result.title } };
    case "contact":
      return { screen: "ContactDetail", params: { contactId: result.id, contactName: result.title } };
    case "asset":
      return { screen: "AssetDetail", params: { assetId: result.id, assetName: result.title } };
    case "project":
      return { screen: "ProjectDetail", params: { projectId: result.id, projectName: result.title } };
    case "project_task":
      return { screen: "ProjectTaskDetail", params: { taskId: result.id } };
    default:
      return null;
  }
}

/** Only ask for what the current capabilities can actually open. */
export function searchableTypes(features: Pick<FeatureCapabilities, "assets" | "projects">): SearchableType[] {
  const types: SearchableType[] = ["ticket", "client", "contact"];
  if (features.assets) types.push("asset");
  if (features.projects) types.push("project", "project_task");
  return types;
}
