import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty.tsx";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select.tsx";
import { Download, FileText, Banknote } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { groupByMonth } from "@/lib/groupByMonth.ts";

type Props = { groupId: Id<"groups"> };

const ALL_MONTHS = "all";

export default function MyClaims({ groupId }: Props) {
  const claims = useQuery(api.slips.myClaimedSlips, { groupId });
  const [selectedMonth, setSelectedMonth] = useState<string>(ALL_MONTHS);

  if (claims === undefined) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
      </div>
    );
  }

  if (claims.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon"><FileText /></EmptyMedia>
          <EmptyTitle>No claims yet</EmptyTitle>
          <EmptyDescription>Head to the Slip Pool tab to claim your first slip</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const monthGroups = groupByMonth(claims, (c) => c.usedAt ?? 0);
  const visibleClaims = selectedMonth === ALL_MONTHS
    ? claims
    : monthGroups.find((g) => g.key === selectedMonth)?.items ?? [];
  const totalValue = visibleClaims.reduce((sum, c) => sum + (c.effectiveAmount ?? 0), 0);

  return (
    <div className="space-y-4">
      {/* Month filter */}
      <Select value={selectedMonth} onValueChange={setSelectedMonth}>
        <SelectTrigger className="w-full sm:w-56 cursor-pointer">
          <SelectValue placeholder="All months" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_MONTHS} className="cursor-pointer">All months</SelectItem>
          {monthGroups.map((g) => (
            <SelectItem key={g.key} value={g.key} className="cursor-pointer">
              {g.label} ({g.items.length})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Summary */}
      <div className="flex items-center gap-4 p-4 bg-muted/40 border rounded-lg">
        <div className="flex-1">
          <p className="text-xs text-muted-foreground">
            {selectedMonth === ALL_MONTHS ? "Your claimed slips" : "Claimed this month"}
          </p>
          <p className="text-2xl font-bold">{visibleClaims.length}</p>
        </div>
        {totalValue > 0 && (
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Total value</p>
            <p className="text-2xl font-bold text-primary">₨{totalValue.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
          </div>
        )}
      </div>

      {/* Claims list */}
      {visibleClaims.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><FileText /></EmptyMedia>
            <EmptyTitle>No claims in this month</EmptyTitle>
            <EmptyDescription>Try a different month, or select "All months"</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
      <div className="space-y-2">
        {[...visibleClaims]
          .sort((a, b) =>
            new Date(b.usedAt ?? 0).getTime() - new Date(a.usedAt ?? 0).getTime()
          )
          .map((claim) => (
            <div
              key={claim._id}
              className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/20 transition-colors"
            >
              <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4 text-primary" />
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {claim.fileName.replace(/\.pdf$/i, "")} — Page {claim.pageNumber}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  {claim.effectiveAmount !== undefined && (
                    <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                      <Banknote className="w-3 h-3" />
                      {claim.effectiveAmount.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </span>
                  )}
                  {claim.usedAt && (
                    <span className="text-xs text-muted-foreground">
                      · {formatDistanceToNow(new Date(claim.usedAt), { addSuffix: true })}
                    </span>
                  )}
                </div>
              </div>

              {claim.url && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="cursor-pointer h-7 text-xs gap-1.5 shrink-0"
                  onClick={() => window.open(claim.url!, "_blank")}
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </Button>
              )}
            </div>
          ))}
      </div>
      )}
    </div>
  );
}
