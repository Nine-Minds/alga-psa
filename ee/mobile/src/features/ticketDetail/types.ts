import type { ApiClient } from "../../api";
import type { MobileSession } from "../../auth/AuthContext";

export type TicketDetailDeps = {
  client: ApiClient | null;
  session: MobileSession | null;
  ticketId: string;
  showToast: (opts: { message: string; tone: "info" | "success" | "error" }) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
};

export const MAX_COMMENT_LENGTH = 5000;
