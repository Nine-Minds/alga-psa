import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
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
  type CallOrigin,
  type PendingCall,
  type PendingCallPrompt,
} from "./usePendingCallPrompt";

let latest: { prompt: PendingCallPrompt | null; dismiss: () => void } | null = null;

function Harness({ origin }: { origin: CallOrigin }) {
  latest = usePendingCallPrompt(origin);
  return null;
}

function mount(origin: CallOrigin = { kind: "contact", id: "contact-1" }): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(React.createElement(Harness, { origin }));
  });
  return renderer;
}

function resume() {
  act(() => {
    resumeCallback?.();
  });
}

const NOW = new Date(2026, 8, 14, 12, 0, 0).getTime();

function call(overrides: Partial<PendingCall> = {}): PendingCall {
  return {
    origin: { kind: "contact", id: "contact-1" },
    phone: "+15550100",
    name: "Jane Doe",
    contactId: "contact-1",
    clientId: "client-1",
    ticketId: null,
    opportunityId: null,
    startedAtMs: NOW - 5 * 60_000,
    ...overrides,
  };
}

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

  it("exposes the callee, links, and elapsed duration when resuming within the window", () => {
    mount();
    recordPendingCall(call({ ticketId: "ticket-9" }));

    resume();

    expect(latest?.prompt).toEqual({
      phone: "+15550100",
      name: "Jane Doe",
      contactId: "contact-1",
      clientId: "client-1",
      ticketId: "ticket-9",
      opportunityId: null,
      durationMinutes: 5,
    });
  });

  it("rounds partial minutes up to at least one", () => {
    mount();
    recordPendingCall(call({ startedAtMs: NOW - 20_000 }));

    resume();

    expect(latest?.prompt?.durationMinutes).toBe(1);
  });

  it("exposes nothing when resuming after the window, and never fires twice", () => {
    mount();
    recordPendingCall(call({ startedAtMs: NOW - 5 * 60 * 60_000 }));

    resume();
    expect(latest?.prompt).toBeNull();

    recordPendingCall(call());
    resume();
    expect(latest?.prompt).not.toBeNull();
    act(() => latest?.dismiss());
    resume();
    expect(latest?.prompt).toBeNull();
  });

  it("only surfaces on the screen the call was placed from", () => {
    mount({ kind: "contact", id: "contact-2" });
    recordPendingCall(call());
    resume();
    expect(latest?.prompt).toBeNull();

    // Same id on a different screen kind is a different origin too.
    mount({ kind: "client", id: "contact-1" });
    resume();
    expect(latest?.prompt).toBeNull();

    // The record is still waiting for the right screen.
    mount({ kind: "contact", id: "contact-1" });
    resume();
    expect(latest?.prompt?.name).toBe("Jane Doe");
  });

  it("surfaces on mount when the screen was remounted behind the biometric lock", () => {
    // The lock view replaces the navigator, so the originating screen is not
    // mounted at resume time; it has to pick the call up when it comes back.
    recordPendingCall(call({ startedAtMs: NOW - 2 * 60_000 }));

    mount();

    expect(latest?.prompt?.durationMinutes).toBe(2);
  });

  it("clears the prompt on dismiss", () => {
    mount();
    recordPendingCall(call());
    resume();
    expect(latest?.prompt).not.toBeNull();

    act(() => {
      latest?.dismiss();
    });

    expect(latest?.prompt).toBeNull();
  });
});
