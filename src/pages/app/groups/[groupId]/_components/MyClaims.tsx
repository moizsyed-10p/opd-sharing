import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty.tsx";
import { Download, FileText, IndianRupee } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type Props = { groupId: Id<"groups"> };

export default function MyClaims({ groupId }: Props) {
  const claims = useQuery(api.slips.myClaimedSlips, { groupId });

  if (claims === undefined) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
      </div>
    );
  }

  const totalValue = claims.reduce((sum, c) => sum + (c.effectiveAmount ?? 0), 0);

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

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-4 p-4 bg-muted/40 border rounded-lg">
        <div className="flex-1">
          <p className="text-xs text-muted-foreground">Your claimed slips</p>
          <p className="text-2xl font-bold">{claims.length}</p>
        </div>
        {totalValue > 0 && (
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Total value</p>
            <p className="text-2xl font-bold text-primary">₹{totalValue.toLocaleString()}</p>
          </div>
        )}
      </div>

      {/* Claims list */}
      <div className="space-y-2">
        {[...claims]
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
                      <IndianRupee className="w-3 h-3" />
                      {claim.effectiveAmount.toLocaleString()}
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
    </div>
  );
}
