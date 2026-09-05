import { describe, expect, it } from "vitest";
import {
  activeTicketNotificationSuppression,
  DEFAULT_TICKET_NOTIFICATION_SUPPRESSION,
} from "./TicketUpdateFooter";

describe("ticket notification suppression", () => {
  it("omits inactive default flags from ticket requests", () => {
    expect(activeTicketNotificationSuppression(DEFAULT_TICKET_NOTIFICATION_SUPPRESSION)).toBeUndefined();
  });

  it("preserves customer-only suppression", () => {
    expect(activeTicketNotificationSuppression({
      suppressContactNotifications: true,
      suppressInternalNotifications: false,
    })).toEqual({
      suppressContactNotifications: true,
      suppressInternalNotifications: false,
    });
  });

  it("does not permit internal-only suppression to become active", () => {
    expect(activeTicketNotificationSuppression({
      suppressContactNotifications: false,
      suppressInternalNotifications: true,
    })).toBeUndefined();
  });
});
