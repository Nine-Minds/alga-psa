import { describe, expect, it, vi } from "vitest";
import {
  completeNextAction,
  completeOpportunityStep,
  createOpportunity,
  getOpportunity,
  getOpportunityTimeline,
  getWorkQueue,
  listOpportunities,
  listOpportunitySteps,
  loseOpportunity,
  winOpportunity,
} from "./opportunities";
import type { ApiClient } from "./client";

function mockClient(response: unknown = { ok: true, data: { data: [] } }): ApiClient {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as ApiClient;
}

const apiKey = "api-key-1";

describe("opportunities api", () => {
  it("list passes status/search and page_size", async () => {
    const client = mockClient();
    await listOpportunities(client, { apiKey, page: 1, pageSize: 25, status: "open", search: "acme" });
    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/opportunities",
      signal: undefined,
      query: { page: 1, page_size: 25, status: "open", search: "acme" },
      headers: { "x-api-key": apiKey },
    });
  });

  it("detail, work-queue and timeline hit their endpoints", async () => {
    const client = mockClient();
    await getOpportunity(client, { apiKey, opportunityId: "opp-1" });
    expect(client.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: "GET", path: "/api/v1/opportunities/opp-1" }),
    );
    await getWorkQueue(client, { apiKey });
    expect(client.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: "GET", path: "/api/v1/opportunities/work-queue" }),
    );
    await getOpportunityTimeline(client, { apiKey, opportunityId: "opp-1" });
    expect(client.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: "GET", path: "/api/v1/opportunities/opp-1/timeline" }),
    );
    await listOpportunitySteps(client, { apiKey, opportunityId: "opp-1" });
    expect(client.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: "GET", path: "/api/v1/opportunities/opp-1/steps" }),
    );
  });

  it("completes a planned opportunity step with its chosen successor", async () => {
    const client = mockClient();
    await completeOpportunityStep(client, {
      apiKey,
      opportunityId: "opp-1",
      stepId: "step-1",
      data: { next_step_id: "step-2", checkpoint: "assessment" },
    });
    expect(client.request).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      path: "/api/v1/opportunities/opp-1/steps/step-1/complete",
      body: { next_step_id: "step-2", checkpoint: "assessment" },
    }));
  });

  it("complete-action posts successor action and due date", async () => {
    const client = mockClient();
    await completeNextAction(client, {
      apiKey,
      opportunityId: "opp-1",
      data: { next_action: "Send proposal", next_action_due: "2026-07-20T09:00:00.000Z" },
    });
    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/opportunities/opp-1/complete-action",
        body: { next_action: "Send proposal", next_action_due: "2026-07-20T09:00:00.000Z" },
      }),
    );
  });

  it("creates an opportunity through the collection endpoint", async () => {
    const client = mockClient();
    const data = {
      client_id: "11111111-1111-4111-8111-111111111111",
      title: "Acme expansion",
      opportunity_type: "expansion" as const,
      currency_code: "USD",
      next_action: "Schedule discovery call",
      next_action_due: "2026-08-25T09:00:00.000Z",
    };
    await createOpportunity(client, { apiKey, data });
    expect(client.request).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/v1/opportunities",
      signal: undefined,
      headers: { "x-api-key": apiKey },
      body: data,
    });
  });

  it("win posts to /win and lose posts loss_reason", async () => {
    const client = mockClient();
    await winOpportunity(client, { apiKey, opportunityId: "opp-1" });
    expect(client.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: "POST", path: "/api/v1/opportunities/opp-1/win" }),
    );
    await loseOpportunity(client, {
      apiKey,
      opportunityId: "opp-1",
      data: { loss_reason: "chose_competitor", lost_to: "CompetitorCo" },
    });
    expect(client.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/opportunities/opp-1/lose",
        body: { loss_reason: "chose_competitor", lost_to: "CompetitorCo" },
      }),
    );
  });
});
