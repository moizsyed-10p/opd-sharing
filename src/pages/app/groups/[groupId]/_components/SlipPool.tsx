import { useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { toast } from "sonner";
import { ConvexError } from "convex/values";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty.tsx";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger
} from "@/components/ui/tooltip.tsx";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu.tsx";
import {
  Download, FileText, CheckCircle, IndianRupee, MoreHorizontal, RotateCcw, Pencil, Check, X, Sparkles, Loader2
} from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { formatDistanceToNow } from "date-fns";

type FilterType = "all" | "available" | "claimed";

type Props = {
  groupId: Id<"groups">;
  isAdmin: boolean;
};

type Slip = {
  _id: Id<"opdSlips">;
  _creationTime: number;
  groupId: Id<"groups">;
  fileId: Id<"opdFiles">;
  pageNumber: number;
  storageId: string;
  amount?: number;
  amountOverride?: number;
  isUsed: boolean;
  usedBy?: Id<"users">;
  usedAt?: string;
  url: string | null;
  fileName: string;
  claimerName: string | undefined;
  effectiveAmount: number | undefined;
};

export default function SlipPool({ groupId, isAdmin }: Props) {
  const [filter, setFilter] = useState<FilterType>("all");
  const [claimingId, setClaimingId] = useState<Id<"opdSlips"> | null>(null);
  const [editingAmountId, setEditingAmountId] = useState<Id<"opdSlips"> | null>(null);
  const [amountInput, setAmountInput] = useState("");
  const [isMatching, setIsMatching] = useState(false);

  const slips = useQuery(api.slips.listGroupSlips, { groupId, filter });
  const claimSlip = useMutation(api.slips.claimSlip);
  const unclaimSlip = useMutation(api.slips.unclaimSlip);
  const updateAmount = useMutation(api.slips.updateSlipAmount);
  const runSmartMatch = useAction(api.amountMatchingAction.runSmartAmountMatching);

  const handleSmartMatch = async () => {
    setIsMatching(true);
    try {
      const result = await runSmartMatch({ groupId });
      if (result.processed === 0) {
        toast.info("All slips already have amounts set.");
      } else {
        toast.success(`Smart match complete`, {
          description: `${result.matched} of ${result.processed} slips matched with amounts.`,
        });
      }
    } catch {
      toast.error("Smart amount matching failed");
    } finally {
      setIsMatching(false);
    }
  };

  const handleClaim = async (slip: Slip) => {
    if (claimingId) return;
    setClaimingId(slip._id);
    try {
      const { url } = await claimSlip({ slipId: slip._id });
      toast.success("Slip claimed!", {
        description: "Downloading now...",
        action: url ? {
          label: "Open",
          onClick: () => window.open(url, "_blank"),
        } : undefined,
      });
      if (url) {
        // Trigger download
        const a = document.createElement("a");
        a.href = url;
        a.download = `slip-page-${slip.pageNumber}.pdf`;
        a.target = "_blank";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch (err) {
      const msg = err instanceof ConvexError
        ? (err.data as { message: string }).message
        : "Failed to claim slip";
      toast.error(msg);
    } finally {
      setClaimingId(null);
    }
  };

  const handleUnclaim = async (slipId: Id<"opdSlips">) => {
    try {
      await unclaimSlip({ slipId });
      toast.success("Slip unclaimed");
    } catch (err) {
      const msg = err instanceof ConvexError
        ? (err.data as { message: string }).message
        : "Failed to unclaim";
      toast.error(msg);
    }
  };

  const startEditAmount = (slip: Slip) => {
    setEditingAmountId(slip._id);
    setAmountInput(slip.effectiveAmount?.toString() ?? "");
  };

  const saveAmount = async (slipId: Id<"opdSlips">) => {
    const parsed = parseFloat(amountInput);
    const amount = isNaN(parsed) ? null : parsed;
    try {
      await updateAmount({ slipId, amount });
      toast.success("Amount updated");
    } catch {
      toast.error("Failed to update amount");
    }
    setEditingAmountId(null);
    setAmountInput("");
  };

  const cancelEdit = () => {
    setEditingAmountId(null);
    setAmountInput("");
  };

  if (slips === undefined) {
    return (
      <div className="space-y-2 mt-4">
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
      </div>
    );
  }

  const available = slips.filter((s) => !s.isUsed).length;
  const claimed = slips.filter((s) => s.isUsed).length;
  const totalAmount = slips
    .filter((s) => !s.isUsed && s.effectiveAmount !== undefined)
    .reduce((sum, s) => sum + (s.effectiveAmount ?? 0), 0);

  return (
    <div className="space-y-4">
      {/* Header row with smart match button */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Slip Pool</h3>
        {slips.length > 0 && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="secondary"
                  className="cursor-pointer h-7 text-xs gap-1.5"
                  onClick={handleSmartMatch}
                  disabled={isMatching}
                >
                  {isMatching
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Sparkles className="w-3.5 h-3.5" />
                  }
                  {isMatching ? "Matching..." : "Smart Match"}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                <p className="text-xs">Auto-extract OPD amounts from slip PDFs</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      {/* Stats bar */}
      {slips.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-muted/40 border rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-primary">{available}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Available</p>
          </div>
          <div className="bg-muted/40 border rounded-lg p-3 text-center">
            <p className="text-xl font-bold">{claimed}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Claimed</p>
          </div>
          <div className="bg-muted/40 border rounded-lg p-3 text-center">
            <p className="text-xl font-bold">
              {totalAmount > 0 ? `₹${totalAmount.toLocaleString()}` : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">Pool Value</p>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterType)}>
        <TabsList className="h-8">
          <TabsTrigger value="all" className="text-xs h-6 cursor-pointer">All ({slips.length})</TabsTrigger>
          <TabsTrigger value="available" className="text-xs h-6 cursor-pointer">Available ({available})</TabsTrigger>
          <TabsTrigger value="claimed" className="text-xs h-6 cursor-pointer">Claimed ({claimed})</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Slip grid */}
      {slips.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><FileText /></EmptyMedia>
            <EmptyTitle>No slips in the pool</EmptyTitle>
            <EmptyDescription>Upload a PDF above to add slips to the shared pool</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-2">
          {slips.map((slip) => (
            <SlipRow
              key={slip._id}
              slip={slip}
              isAdmin={isAdmin}
              isClaiming={claimingId === slip._id}
              isEditingAmount={editingAmountId === slip._id}
              amountInput={amountInput}
              onClaim={() => handleClaim(slip)}
              onUnclaim={() => handleUnclaim(slip._id)}
              onStartEdit={() => startEditAmount(slip)}
              onSaveAmount={() => saveAmount(slip._id)}
              onCancelEdit={cancelEdit}
              onAmountInputChange={setAmountInput}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type SlipRowProps = {
  slip: Slip;
  isAdmin: boolean;
  isClaiming: boolean;
  isEditingAmount: boolean;
  amountInput: string;
  onClaim: () => void;
  onUnclaim: () => void;
  onStartEdit: () => void;
  onSaveAmount: () => void;
  onCancelEdit: () => void;
  onAmountInputChange: (v: string) => void;
};

function SlipRow({
  slip, isAdmin, isClaiming, isEditingAmount,
  amountInput, onClaim, onUnclaim, onStartEdit,
  onSaveAmount, onCancelEdit, onAmountInputChange,
}: SlipRowProps) {
  const fileShortName = slip.fileName.replace(/\.pdf$/i, "").slice(0, 30);

  return (
    <div className={cn(
      "flex items-center gap-3 p-3 rounded-lg border transition-colors",
      slip.isUsed
        ? "bg-muted/20 border-border/50 opacity-70"
        : "bg-card hover:bg-muted/20 border-border"
    )}>
      {/* Status icon */}
      <div className={cn(
        "w-8 h-8 rounded-md flex items-center justify-center shrink-0",
        slip.isUsed ? "bg-muted" : "bg-primary/10"
      )}>
        {slip.isUsed
          ? <CheckCircle className="w-4 h-4 text-green-500" />
          : <FileText className="w-4 h-4 text-primary" />
        }
      </div>

      {/* Slip info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">
            {fileShortName} — Page {slip.pageNumber}
          </span>
          {slip.isUsed && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">Claimed</Badge>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          {/* Amount */}
          {isEditingAmount ? (
            <div className="flex items-center gap-1.5">
              <IndianRupee className="w-3 h-3 text-muted-foreground" />
              <Input
                value={amountInput}
                onChange={(e) => onAmountInputChange(e.target.value)}
                className="h-5 w-20 text-xs px-1.5 py-0"
                type="number"
                min="0"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSaveAmount();
                  if (e.key === "Escape") onCancelEdit();
                }}
              />
              <button onClick={onSaveAmount} className="cursor-pointer text-green-600 hover:text-green-700">
                <Check className="w-3.5 h-3.5" />
              </button>
              <button onClick={onCancelEdit} className="cursor-pointer text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={onStartEdit}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer group"
            >
              <IndianRupee className="w-3 h-3" />
              <span>
                {slip.effectiveAmount !== undefined
                  ? slip.effectiveAmount.toLocaleString()
                  : "Set amount"}
              </span>
              <Pencil className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          )}

          {slip.isUsed && slip.claimerName && (
            <span className="text-xs text-muted-foreground">
              by {slip.claimerName}
              {slip.usedAt && (
                <> · {formatDistanceToNow(new Date(slip.usedAt), { addSuffix: true })}</>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        {!slip.isUsed && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  onClick={onClaim}
                  disabled={isClaiming}
                  className="cursor-pointer h-7 text-xs gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  {isClaiming ? "Claiming..." : "Claim"}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                <p className="text-xs">Download & mark as claimed</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {slip.isUsed && slip.url && (
          <Button
            size="sm"
            variant="secondary"
            className="cursor-pointer h-7 text-xs gap-1.5"
            onClick={() => window.open(slip.url!, "_blank")}
          >
            <Download className="w-3.5 h-3.5" />
            Re-download
          </Button>
        )}

        {isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="cursor-pointer h-7 w-7 p-0">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => window.open(slip.url ?? "#", "_blank")}
                className="cursor-pointer text-xs"
              >
                <FileText className="w-3.5 h-3.5 mr-2" />
                Preview
              </DropdownMenuItem>
              {slip.isUsed && (
                <DropdownMenuItem
                  onClick={onUnclaim}
                  className="cursor-pointer text-xs text-destructive focus:text-destructive"
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-2" />
                  Unclaim
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
