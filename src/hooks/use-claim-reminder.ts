import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { useEffect, useState } from "react";

function dismissKey(groupId: Id<"groups">) {
  const now = new Date();
  const yyyyMm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return `claim-reminder-dismissed-${groupId}-${yyyyMm}`;
}

export function useClaimReminder(groupId: Id<"groups">) {
  const status = useQuery(api.dashboard.getClaimReminderStatus, { groupId });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(localStorage.getItem(dismissKey(groupId)) === "1");
  }, [groupId]);

  const dismiss = () => {
    localStorage.setItem(dismissKey(groupId), "1");
    setDismissed(true);
  };

  return {
    visible: Boolean(status?.shouldRemind) && !dismissed,
    unclaimedCount: status?.unclaimedCount ?? 0,
    monthLabel: status?.monthLabel ?? "",
    dismiss,
  };
}
