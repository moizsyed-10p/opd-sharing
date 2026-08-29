import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible.tsx";
import { AlertOctagon, ChevronDown } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils.ts";

type Props = { groupId: Id<"groups"> };

const contextLabels: Record<string, string> = {
  bulk_claim: "Bulk claim",
  smart_match: "Smart Match",
  single_claim: "Single claim",
};

export default function ErrorLogPanel({ groupId }: Props) {
  const logs = useQuery(api.clientLogs.listGroupErrorLogs, { groupId });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!logs || logs.length === 0) return null;

  return (
    <Card className="mt-6 border-destructive/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2 text-destructive">
          <AlertOctagon className="w-4 h-4" />
          Error Log ({logs.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {logs.map((log) => {
          const isExpanded = expandedId === log._id;
          return (
            <Collapsible
              key={log._id}
              open={isExpanded}
              onOpenChange={(open) => setExpandedId(open ? log._id : null)}
            >
              <div className="border rounded-lg overflow-hidden">
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-start gap-3 p-3 text-left cursor-pointer hover:bg-muted/30 transition-colors">
                    <Badge variant="outline" className="text-[10px] shrink-0 mt-0.5">
                      {contextLabels[log.context] ?? log.context}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{log.message}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {log.reporterName ?? "Unknown user"} · {formatDistanceToNow(new Date(log._creationTime), { addSuffix: true })}
                        {log.slipIds && log.slipIds.length > 0 && ` · ${log.slipIds.length} slip${log.slipIds.length !== 1 ? "s" : ""} involved`}
                      </p>
                    </div>
                    <ChevronDown className={cn("w-4 h-4 shrink-0 mt-0.5 transition-transform", isExpanded && "rotate-180")} />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="border-t bg-muted/20 p-3 space-y-2 text-xs">
                    {log.userAgent && (
                      <p className="text-muted-foreground break-all">
                        <span className="font-medium text-foreground">User agent:</span> {log.userAgent}
                      </p>
                    )}
                    {log.stack && (
                      <pre className="whitespace-pre-wrap break-all bg-background border rounded p-2 text-[11px] text-muted-foreground">
                        {log.stack}
                      </pre>
                    )}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          );
        })}
      </CardContent>
    </Card>
  );
}
