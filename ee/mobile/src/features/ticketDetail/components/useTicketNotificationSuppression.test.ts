import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const capabilities = vi.hoisted(() => ({ dontNotifyCustomerDefault: false }));
vi.mock("../../../capabilities/CapabilitiesContext", () => ({
  useDontNotifyCustomerDefault: () => capabilities.dontNotifyCustomerDefault,
}));

import { useTicketNotificationSuppression } from "./useTicketNotificationSuppression";

describe("tenant notification suppression defaults", () => {
  let renderer: ReactTestRenderer;
  let state: ReturnType<typeof useTicketNotificationSuppression>;

  function Probe() {
    state = useTicketNotificationSuppression();
    return null;
  }

  beforeEach(() => {
    capabilities.dontNotifyCustomerDefault = false;
    act(() => { renderer = create(React.createElement(Probe)); });
  });

  afterEach(() => {
    act(() => { renderer.unmount(); });
  });

  function loadDefault(value: boolean) {
    act(() => {
      capabilities.dontNotifyCustomerDefault = value;
      renderer.update(React.createElement(Probe));
    });
  }

  it("starts unticked until the capability arrives, then ticks only the customer box", () => {
    expect(state.suppression).toEqual({
      suppressContactNotifications: false,
      suppressInternalNotifications: false,
    });
    loadDefault(true);
    expect(state.suppression).toEqual({
      suppressContactNotifications: true,
      suppressInternalNotifications: false,
    });
  });

  it("preserves an explicit choice even after toggling back to the initial value", () => {
    act(() => { state.setSuppression({ suppressContactNotifications: true, suppressInternalNotifications: false }); });
    act(() => { state.setSuppression({ suppressContactNotifications: false, suppressInternalNotifications: false }); });
    loadDefault(true);
    expect(state.suppression.suppressContactNotifications).toBe(false);
  });

  it("resets to the latest default without changing the reset callback identity", () => {
    const reset = state.reset;
    act(() => { state.setSuppression({ suppressContactNotifications: false, suppressInternalNotifications: false }); });
    loadDefault(true);
    expect(state.reset).toBe(reset);
    act(() => { reset(); });
    expect(state.suppression).toEqual({
      suppressContactNotifications: true,
      suppressInternalNotifications: false,
    });
    loadDefault(false);
    expect(state.suppression.suppressContactNotifications).toBe(false);
  });
});
