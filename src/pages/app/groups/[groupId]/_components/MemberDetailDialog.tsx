import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { FileText, CheckCircle, Upload } from "lucide-react";
import { format } from "date-fns";
import { groupByMonth } from "@/lib/groupByMonth.ts";

type Props = {
  groupId: Id<"groups">;
  userId: Id<"users"> | null;
  memberName: string;
  initialTab?: "claims" | "uploads";
  onClose: () => void;
};

const fmt = (n: number) => n.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export default function MemberDetailDialog({ groupId, userId, memberName, initialTab = "claims", onClose }: Props) {
  const detail = useQuery(
    api.dashboard.memberDetail,
    userId ? { groupId, userId } : "skip"
  );

  return (
    <Dialog open={userId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{memberName}</DialogTitle>
        </DialogHeader>

        {!detail ? (
          <div className="space-y-2 py-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : (
          <Tabs defaultValue={initialTab} className="flex-1 overflow-hidden flex flex-col">
            <TabsList className="h-8 shrink-0">
              <TabsTrigger value="claims" className="text-xs h-6 cursor-pointer">
                Claims ({detail.claims.length})
              </TabsTrigger>
              <TabsTrigger value="uploads" className="text-xs h-6 cursor-pointer">
                Uploads ({detail.uploads.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="claims" className="flex-1 overflow-y-auto mt-2 space-y-4 pr-1">
              {detail.claims.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">No claims yet</p>
              ) : (
                groupByMonth(detail.claims, (c) => c.claimedAt).map((group) => (
                  <div key={group.key} className="space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground sticky top-0 bg-background py-1">
                      {group.label}
                    </p>
                    {group.items.map((c) => (
                      <div key={c.slipId} className="flex items-center gap-3 py-1.5 border-b last:border-0">
                        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <CheckCircle className="w-3.5 h-3.5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate">
                            {c.fileName.replace(/\.pdf$/i, "").slice(0, 24)} — Page {c.pageNumber}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {format(new Date(c.claimedAt), "MMM d, yyyy")}
                          </p>
                        </div>
                        {c.effectiveAmount !== undefined && (
                          <span className="text-xs font-medium shrink-0">₨{fmt(c.effectiveAmount)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                ))
              )}
            </TabsContent>

            <TabsContent value="uploads" className="flex-1 overflow-y-auto mt-2 space-y-4 pr-1">
              {detail.uploads.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">No uploads yet</p>
              ) : (
                groupByMonth(detail.uploads, (u) => u.createdAt).map((group) => (
                  <div key={group.key} className="space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground sticky top-0 bg-background py-1">
                      {group.label}
                    </p>
                    {group.items.map((u) => (
                      <div key={u.fileId} className="flex items-center gap-3 py-1.5 border-b last:border-0">
                        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <Upload className="w-3.5 h-3.5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate flex items-center gap-1.5">
                            <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            {u.fileName.replace(/\.pdf$/i, "").slice(0, 24)}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {format(new Date(u.createdAt), "MMM d, yyyy")} · {u.slipCount} slip{u.slipCount !== 1 ? "s" : ""}
                          </p>
                        </div>
                        {u.uploadedValue > 0 && (
                          <span className="text-xs font-medium shrink-0">₨{fmt(u.uploadedValue)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                ))
              )}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
