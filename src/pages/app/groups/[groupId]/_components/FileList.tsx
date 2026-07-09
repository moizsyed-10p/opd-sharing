import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { toast } from "sonner";
import { ConvexError } from "convex/values";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty.tsx";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger
} from "@/components/ui/alert-dialog.tsx";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger
} from "@/components/ui/collapsible.tsx";
import { FileText, Trash2, ChevronDown, Loader2, CheckCircle, AlertCircle, Clock, Eye } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import SlipPreviewList from "./SlipPreviewList.tsx";
import { useState } from "react";
import { groupByMonth } from "@/lib/groupByMonth.ts";

type Props = {
  groupId: Id<"groups">;
  isAdmin: boolean;
};

const statusConfig = {
  pending: { label: "Pending", icon: Clock, className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
  processing: { label: "Processing", icon: Loader2, className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  done: { label: "Ready", icon: CheckCircle, className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  error: { label: "Error", icon: AlertCircle, className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
};

export default function FileList({ groupId, isAdmin }: Props) {
  const files = useQuery(api.files.listOpdFiles, { groupId });
  const deleteFile = useMutation(api.files.deleteOpdFile);
  const [expandedFileId, setExpandedFileId] = useState<Id<"opdFiles"> | null>(null);

  const handleDelete = async (fileId: Id<"opdFiles">) => {
    try {
      await deleteFile({ fileId });
      toast.success("File deleted");
    } catch (err) {
      const msg = err instanceof ConvexError
        ? (err.data as { message: string }).message
        : "Failed to delete file";
      toast.error(msg);
    }
  };

  if (files === undefined) {
    return (
      <div className="space-y-2">
        {[1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon"><FileText /></EmptyMedia>
          <EmptyTitle>No files uploaded yet</EmptyTitle>
          <EmptyDescription>Upload a multi-page OPD PDF to create a slip pool for your group</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const monthGroups = groupByMonth(files, (f) => f._creationTime);

  return (
    <div className="space-y-5">
      {monthGroups.map((group) => (
        <div key={group.key} className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">{group.label}</p>
          <div className="space-y-2">
            {group.items.map((file) => {
              const { label, icon: Icon, className } = statusConfig[file.status];
              const isExpanded = expandedFileId === file._id;

              return (
                <Collapsible
            key={file._id}
            open={isExpanded}
            onOpenChange={(open) => setExpandedFileId(open ? file._id : null)}
          >
            <div className="border rounded-lg overflow-hidden">
              <div className="flex items-center gap-3 p-3 bg-card hover:bg-muted/30 transition-colors">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4 text-primary" />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.originalName}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-muted-foreground">
                      by {file.uploaderName ?? "Unknown"}
                    </span>
                    {file.status === "done" && (
                      <span className="text-xs text-muted-foreground">
                        · {file.slipCount} slips · {file.usedCount} claimed
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className={cn("flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full", className)}>
                    <Icon className={cn("w-3 h-3", file.status === "processing" && "animate-spin")} />
                    {label}
                  </span>

                  {file.status === "done" && (
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="cursor-pointer h-7 w-7 p-0">
                        <ChevronDown className={cn("w-4 h-4 transition-transform", isExpanded && "rotate-180")} />
                      </Button>
                    </CollapsibleTrigger>
                  )}

                  {isAdmin && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="cursor-pointer h-7 w-7 p-0 text-destructive hover:text-destructive">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete file?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently delete all {file.slipCount} slips from this file. This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDelete(file._id)}
                            className="cursor-pointer bg-destructive hover:bg-destructive/90"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </div>

              <CollapsibleContent>
                <div className="border-t bg-muted/20 p-3">
                  <SlipPreviewList fileId={file._id} />
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
