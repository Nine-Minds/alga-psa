import React, { type ReactNode, useState } from "react";
import { Card } from "../../../ui/components/Card";
import { SectionHeader } from "../../../ui/components/SectionHeader";
import { useTranslation } from "react-i18next";
import { SectionCollapseToggle } from "./SectionCollapseToggle";

export function TicketDetailsSection({
  children,
  initiallyCollapsed = false,
}: {
  children: ReactNode;
  initiallyCollapsed?: boolean;
}) {
  const { t } = useTranslation("tickets");
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);

  return (
    <Card accessibilityLabel={t("detail.details", "Details")}>
      <SectionHeader
        title={t("detail.details", "Details")}
        action={(
          <SectionCollapseToggle
            collapsed={collapsed}
            onToggle={() => setCollapsed((value) => !value)}
            sectionLabel={t("detail.details", "Details")}
          />
        )}
      />
      {collapsed ? null : children}
    </Card>
  );
}
