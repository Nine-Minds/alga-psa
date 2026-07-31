import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let resumeCallback: (() => void) | null = null;
vi.mock("../../../hooks/useAppResume", () => ({
  useAppResume: (cb: () => void) => {
    resumeCallback = cb;
  },
}));

import {
  clearPendingCall,
  recordPendingCall,
  usePendingCallPrompt,
  type PendingCallPrompt,
} from "./usePendingCallPrompt";

let latest: { prompt: PendingCallPrompt | null; dismiss: () => void } | null = null;

function Harness({ opportunityId }: { opportunityId: string }) {
  latest = usePendingCallPrompt(opportunityId);
  return null;
}

function mount(opportunityId = "opp-1") {
  act(() => {
    create(React.createElement(Harness, { opportunityId }));
  });
}

function resume() {
  act(() => {
    resumeCallback?.();
  });
}

const NOW = new Date(2026, 6, 16, 12, 0, 0).getTime();

describe("usePendingCallPrompt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    resumeCallback = null;
    latest = null;
    clearPendingCall();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exposes a prompt with elapsed duration when resuming within the window", () => {
    mount("opp-1");
    recordPendingCall({
      opportunityId: "opp-1",
      contactName: "Jane Doe",
      contactId: "contact-1",
      clientId: "client-1",
      startedAtMs: NOW - 5 * 60_000,
    });

    resume();

    expect(latest?.prompt).not.toBeNull();
    expect(latest?.prompt?.durationMinutes).toBe(5);
    expect(latest?.prompt?.contactName).toBe("Jane Doe");
    expect(latest?.prompt?.contactId).toBe("contact-1");
  });

  it("rounds partial minutes up to at least one", () => {
    mount("opp-1");
    recordPendingCall({
      opportunityId: "opp-1",
      contactName: "Jane",
      contactId: null,
      clientId: null,
      startedAtMs: NOW - 20_000,
    });

    resume();

    expect(latest?.prompt?.durationMinutes).toBe(1);
  });

  it("exposes nothing when resuming after the window", () => {
    mount("opp-1");
    recordPendingCall({
      opportunityId: "opp-1",
      contactName: "Jane",
      contactId: null,
      clientId: null,
      startedAtMs: NOW - 5 * 60 * 60_000, // 5 hours ago
    });

    resume();

    expect(latest?.prompt).toBeNull();
  });

  it("ignores a pending call recorded for a different deal", () => {
    mount("opp-1");
    recordPendingCall({
      opportunityId: "opp-2",
      contactName: "Jane",
      contactId: null,
      clientId: null,
      startedAtMs: NOW - 60_000,
    });

    resume();

    expect(latest?.prompt).toBeNull();
  });

  it("clears the prompt on dismiss", () => {
    mount("opp-1");
    recordPendingCall({
      opportunityId: "opp-1",
      contactName: "Jane",
      contactId: null,
      clientId: null,
      startedAtMs: NOW - 2 * 60_000,
    });

    resume();
    expect(latest?.prompt).not.toBeNull();

    act(() => {
      latest?.dismiss();
    });

    expect(latest?.prompt).toBeNull();
  });
});
