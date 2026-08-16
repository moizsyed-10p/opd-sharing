import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { BellRing, X } from "lucide-react";
import { useClaimReminder } from "@/hooks/use-claim-reminder.ts";

type Props = {
  groupId: Id<"groups">;
  onGoToPool: () => void;
};

export default function ClaimReminderBanner({ groupId, onGoToPool }: Props) {
  const { visible, unclaimedCount, dismiss } = useClaimReminder(groupId);

  if (!visible) return null;

  return (
    <div className="mb-6 flex items-center justify-between gap-3 p-3 rounded-lg border bg-amber-500/10 border-amber-500/20">
      <div className="flex items-center gap-2.5 min-w-0">
        <BellRing className="w-4 h-4 text-amber-600 shrink-0" />
        <p className="text-sm text-amber-700 dark:text-amber-400 truncate">
          You have {unclaimedCount} unclaimed slip{unclaimedCount !== 1 ? "s" : ""} this month — don't forget to claim them.
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Button size="sm" variant="outline" className="cursor-pointer h-7 text-xs" onClick={onGoToPool}>
          Go to Slip Pool
        </Button>
        <Button size="sm" variant="ghost" className="cursor-pointer h-7 w-7 p-0" onClick={dismiss}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
