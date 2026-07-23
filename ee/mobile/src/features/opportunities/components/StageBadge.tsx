import React from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "../../../ui/components/Badge";
import type { OpportunityStage } from "../../../api/opportunities";

type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

const STAGE_TONE: Record<OpportunityStage, BadgeTone> = {
  identified: "neutral",
  qualified: "info",
  assessment: "info",
  proposed: "warning",
  verbal: "warning",
  won: "success",
  lost: "danger",
};

export function StageBadge({ stage }: { stage: OpportunityStage }) {
  const { t } = useTranslation("opportunities");
  return <Badge label={t(`stage.${stage}`, stage)} tone={STAGE_TONE[stage] ?? "neutral"} />;
}
