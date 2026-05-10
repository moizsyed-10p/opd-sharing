import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { FileText, CheckCircle } from "lucide-react";

type Props = {
  fileId: Id<"opdFiles">;
};

export default function SlipPreviewList({ fileId }: Props) {
  const slips = useQuery(api.files.getSlipsForFile, { fileId });

  if (slips === undefined) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
      {slips.map((slip) => (
        <a
          key={slip._id}
          href={slip.url ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 p-2 rounded-md border bg-card hover:bg-muted/50 transition-colors cursor-pointer"
        >
          <div className="w-7 h-7 rounded bg-primary/10 flex items-center justify-center shrink-0">
            {slip.isUsed
              ? <CheckCircle className="w-3.5 h-3.5 text-green-500" />
              : <FileText className="w-3.5 h-3.5 text-primary" />
            }
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">Page {slip.pageNumber}</p>
            {slip.amount !== undefined && (
              <p className="text-[10px] text-muted-foreground">₹{slip.amount}</p>
            )}
          </div>
          {slip.isUsed && (
            <Badge variant="secondary" className="text-[9px] h-4 px-1 shrink-0">Used</Badge>
          )}
        </a>
      ))}
    </div>
  );
}
