import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("../../../ui/ThemeContext", () => ({ useTheme: () => ({ colors: {}, spacing: {}, typography: {} }) }));
vi.mock("../../schedule/components/InteractionEntryContext", () => ({ InteractionEntryContext: () => null }));
vi.mock("../../../ui/components/BottomSheet", () => ({ BottomSheet: () => null }));

import { pickTargetStatus } from "./InteractionDetailSheet";

const statuses = [
  { status_id: "open-b", name: "In progress", is_closed: false, is_default: false },
  { status_id: "open-a", name: "New", is_closed: false, is_default: true },
  { status_id: "done-a", name: "Done", is_closed: true, is_default: false },
  { status_id: "done-b", name: "Cancelled", is_closed: true, is_default: false },
];

describe("pickTargetStatus", () => {
  it("prefers the default status of the requested kind, else the first one", () => {
    expect(pickTargetStatus(statuses, true)?.status_id).toBe("done-a");
    expect(pickTargetStatus(statuses, false)?.status_id).toBe("open-a");
    expect(pickTargetStatus([], true)).toBeNull();
  });
});
