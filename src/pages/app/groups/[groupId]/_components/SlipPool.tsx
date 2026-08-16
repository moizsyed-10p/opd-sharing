import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { toast } from "sonner";
import { ConvexError } from "convex/values";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty.tsx";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger
} from "@/components/ui/tooltip.tsx";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu.tsx";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog.tsx";
import { PDFDocument } from "pdf-lib";
import { format } from "date-fns";
import { compressPdfToMaxSize } from "@/lib/pdfTools.ts";
import {
  Download, FileText, CheckCircle, MoreHorizontal, RotateCcw,
  Pencil, Check, X, Sparkles, Loader2, Users, Target, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { groupByMonth } from "@/lib/groupByMonth.ts";

type FilterType = "all" | "available" | "claimed";

type Props = {
  groupId: Id<"groups">;
  isAdmin: boolean;
  canClaim: boolean;
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
  isClaimedByMe: boolean;
  claimedByCount: number;
  usedBy?: Id<"users">;
  usedAt?: string;
  url: string | null;
  fileName: string;
  claimerName: string | undefined;
  effectiveAmount: number | undefined;
};

type SmartMatchState =
  | { step: "input" }
  | { step: "preview"; selectedSlips: Slip[]; total: number }
  | { step: "claiming" }
  | { step: "done"; total: number; count: number };

function findBestMatch(slips: Slip[], target: number): Slip[] {
  // Sort oldest → newest so the match always draws from the oldest slips first.
  const eligible = slips
    .filter((s) => !s.isClaimedByMe && s.effectiveAmount !== undefined && s.effectiveAmount > 0)
    .sort((a, b) => a._creationTime - b._creationTime);

  const poolTotal = eligible.reduce((sum, s) => sum + (s.effectiveAmount ?? 0), 0);
  if (poolTotal <= target) return eligible;

  const n = eligible.length;
  const amounts = eligible.map((s) => s.effectiveAmount ?? 0);

  // ── Step 1: Greedy pass ─────────────────────────────────────────────────────
  // Take the oldest slips one-by-one until we reach the target.
  // O(n) — guaranteed to find a valid selection without any exponential blow-up.
  const inSelection = new Array<boolean>(n).fill(false);
  let currentSum = 0;
  for (let i = 0; i < n; i++) {
    inSelection[i] = true;
    currentSum += amounts[i];
    if (currentSum >= target) break;
  }

  // ── Step 2: Trim excess ─────────────────────────────────────────────────────
  // Drop the most recently added (newest) selected slips first, as long as the
  // remaining sum still covers the target — this keeps the oldest slips in the
  // selection instead of swapping them out for a tighter numeric fit.
  for (let i = n - 1; i >= 0; i--) {
    if (!inSelection[i]) continue;
    if (currentSum - amounts[i] >= target) {
      inSelection[i] = false;
      currentSum -= amounts[i];
    }
  }

  return eligible.filter((_, i) => inSelection[i]);
}

async function mergePdfs(slips: Slip[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const slip of slips) {
    if (!slip.url) continue;
    const response = await fetch(slip.url);
    const bytes = await response.arrayBuffer();
    const pdf = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(pdf, pdf.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  return merged.save();
}

const fmt = (n: number) => n.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;

export default function SlipPool({ groupId, isAdmin, canClaim }: Props) {
  const [filter, setFilter] = useState<FilterType>("all");
  const [claimingId, setClaimingId] = useState<Id<"opdSlips"> | null>(null);
  const [editingAmountId, setEditingAmountId] = useState<Id<"opdSlips"> | null>(null);
  const [amountInput, setAmountInput] = useState("");

  // Smart Match
  const [smartMatchOpen, setSmartMatchOpen] = useState(false);
  const [smartMatchState, setSmartMatchState] = useState<SmartMatchState>({ step: "input" });
  const [targetAmount, setTargetAmount] = useState("");
  const [isFinding, setIsFinding] = useState(false);

  // Bulk select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

  const slips = useQuery(api.slips.listGroupSlips, { groupId, filter });
  const allSlips = useQuery(api.slips.listGroupSlips, { groupId, filter: "all" });
  const currentUser = useQuery(api.users.getCurrentUser, {});
  const claimSlip = useMutation(api.slips.claimSlip);
  const unclaimSlip = useMutation(api.slips.unclaimSlip);
  const updateAmount = useMutation(api.slips.updateSlipAmount);

  // Bulk helpers
  const selectedSlips = (slips ?? []).filter((s) => selectedIds.has(s._id));
  const selectedClaimable = selectedSlips.filter((s) => !s.isClaimedByMe);
  const selectedUnclaimable = selectedSlips.filter((s) => s.isClaimedByMe);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!slips) return;
    if (selectedIds.size === slips.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(slips.map((s) => s._id)));
    }
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkClaim = async () => {
    if (!canClaim || selectedClaimable.length === 0) return;
    setIsBulkProcessing(true);
    try {
      const claimedUrls: string[] = [];
      for (const slip of selectedClaimable) {
        const { url } = await claimSlip({ slipId: slip._id });
        if (url) claimedUrls.push(url);
      }

      // Merge and download
      const slipsWithUrls = selectedClaimable.map((s, i) => ({
        ...s,
        url: claimedUrls[i] ?? s.url,
      }));

      if (slipsWithUrls.length > 0) {
        const mergedBytes = await mergePdfs(slipsWithUrls);
        const finalBytes = await compressPdfToMaxSize(mergedBytes, MAX_DOWNLOAD_BYTES);
        const blob = new Blob([finalBytes.buffer as ArrayBuffer], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `bulk-claim-${selectedClaimable.length}-slips.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      toast.success(`${selectedClaimable.length} slip${selectedClaimable.length !== 1 ? "s" : ""} claimed & downloaded`);
      clearSelection();
    } catch (err) {
      const msg = err instanceof ConvexError
        ? (err.data as { message: string }).message
        : "Bulk claim failed";
      toast.error(msg);
    } finally {
      setIsBulkProcessing(false);
    }
  };

  const handleBulkUnclaim = async () => {
    if (!isAdmin || selectedUnclaimable.length === 0) return;
    setIsBulkProcessing(true);
    try {
      for (const slip of selectedUnclaimable) {
        await unclaimSlip({ slipId: slip._id });
      }
      toast.success(`${selectedUnclaimable.length} slip${selectedUnclaimable.length !== 1 ? "s" : ""} unclaimed`);
      clearSelection();
    } catch (err) {
      toast.error("Bulk unclaim failed");
    } finally {
      setIsBulkProcessing(false);
    }
  };

  const handleFindMatch = async () => {
    const target = parseFloat(targetAmount);
    if (isNaN(target) || target <= 0) {
      toast.error("Enter a valid target amount");
      return;
    }

    setIsFinding(true);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const available = (allSlips ?? []).filter(
      (s) => !s.isClaimedByMe && s.effectiveAmount !== undefined && s.effectiveAmount > 0
    );
    if (available.length === 0) {
      toast.error("No unclaimed slips with amounts available");
      setIsFinding(false);
      return;
    }
    const selected = findBestMatch(available, target);
    const total = selected.reduce((sum, s) => sum + (s.effectiveAmount ?? 0), 0);
    setIsFinding(false);
    setSmartMatchState({ step: "preview", selectedSlips: selected, total });
  };

  const handleClaimAndDownload = async () => {
    if (smartMatchState.step !== "preview") return;
    const { selectedSlips, total } = smartMatchState;
    setSmartMatchState({ step: "claiming" });
    try {
      const claimedUrls: string[] = [];
      for (const slip of selectedSlips) {
        const { url } = await claimSlip({ slipId: slip._id });
        if (url) claimedUrls.push(url);
      }
      const slipsWithUrls = selectedSlips.map((s, i) => ({ ...s, url: claimedUrls[i] ?? s.url }));
      const mergedBytes = await mergePdfs(slipsWithUrls);
      const finalBytes = await compressPdfToMaxSize(mergedBytes, MAX_DOWNLOAD_BYTES);
      const blob = new Blob([finalBytes.buffer as ArrayBuffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const firstName = (currentUser?.name?.split(" ")[0] ?? "User").replace(/[^a-zA-Z0-9]/g, "");
      const monthName = format(new Date(), "MMMM");
      a.download = `${firstName}_${monthName}_OPD_${Math.round(total)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSmartMatchState({ step: "done", total, count: selectedSlips.length });
      toast.success(`Downloaded ${selectedSlips.length} slips totalling ₨${fmt(total)}`);
    } catch (err) {
      const msg = err instanceof ConvexError
        ? (err.data as { message: string }).message
        : "Failed to claim slips";
      toast.error(msg);
      setSmartMatchState({ step: "preview", selectedSlips, total });
    }
  };

  const handleClaim = async (slip: Slip) => {
    if (!canClaim || claimingId) return;
    setClaimingId(slip._id);
    try {
      const { url } = await claimSlip({ slipId: slip._id });
      toast.success("Slip claimed!", {
        action: url ? { label: "Open", onClick: () => window.open(url, "_blank") } : undefined,
      });
      if (url) {
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
      toast.error("Failed to unclaim");
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

  const available = slips.filter((s) => !s.isClaimedByMe).length;
  const claimed = slips.filter((s) => s.isClaimedByMe).length;
  const totalAmount = slips
    .filter((s) => !s.isClaimedByMe && s.effectiveAmount !== undefined)
    .reduce((sum, s) => sum + (s.effectiveAmount ?? 0), 0);

  const hasSelection = selectedIds.size > 0;
  const allSelected = slips.length > 0 && selectedIds.size === slips.length;

  return (
    <div className="space-y-4">

      {/* Smart Match Dialog */}
      <Dialog open={smartMatchOpen} onOpenChange={(o) => {
        setSmartMatchOpen(o);
        if (!o) { setSmartMatchState({ step: "input" }); setTargetAmount(""); }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              Smart Match
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {smartMatchState.step === "input" && (
              <>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Enter your OPD reimbursement target. The app will find the best combination of unclaimed slips that meets or slightly exceeds your target.
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-muted-foreground">₨</span>
                    <Input
                      type="number"
                      min="0"
                      placeholder="e.g. 45000"
                      value={targetAmount}
                      onChange={(e) => setTargetAmount(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleFindMatch()}
                      className="flex-1"
                      autoFocus
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Available pool: ₨{fmt(totalAmount)} across {available} unclaimed slip{available !== 1 ? "s" : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setSmartMatchOpen(false)} className="cursor-pointer">Cancel</Button>
                  <Button size="sm" onClick={handleFindMatch} disabled={isFinding} className="cursor-pointer flex-1 gap-1.5">
                      {isFinding
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Target className="w-3.5 h-3.5" />
                    }
                    {isFinding ? "Finding best match..." : "Find Slips"}
                  </Button>
                </div>
              </>
            )}
            {smartMatchState.step === "preview" && (
              <>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Selected slips</p>
                    <Badge variant="secondary">₨{fmt(smartMatchState.total)}</Badge>
                  </div>
                  {parseFloat(targetAmount) > 0 && smartMatchState.total < parseFloat(targetAmount) && (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <p className="text-xs text-amber-600">
                        Best available (₨{fmt(smartMatchState.total)}) is less than target ₨{fmt(parseFloat(targetAmount))}
                      </p>
                    </div>
                  )}
                  {parseFloat(targetAmount) > 0 && smartMatchState.total > parseFloat(targetAmount) && (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
                      <CheckCircle className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                      <p className="text-xs text-blue-600">₨{fmt(smartMatchState.total - parseFloat(targetAmount))} over target</p>
                    </div>
                  )}
                  <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                    {smartMatchState.selectedSlips.map((slip) => (
                      <div key={slip._id} className="flex items-center gap-3 p-2.5 rounded-lg border bg-muted/20">
                        <FileText className="w-4 h-4 text-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">
                            {slip.fileName.replace(/\.pdf$/i, "").slice(0, 18)} — Page {slip.pageNumber}
                          </p>
                        </div>
                        <span className="text-xs font-medium shrink-0">₨{fmt(slip.effectiveAmount ?? 0)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t">
                    <span className="text-xs text-muted-foreground">{smartMatchState.selectedSlips.length} slip{smartMatchState.selectedSlips.length !== 1 ? "s" : ""}</span>
                    <span className="text-sm font-semibold">₨{fmt(smartMatchState.total)}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setSmartMatchState({ step: "input" })} className="cursor-pointer">Back</Button>
                  <Button size="sm" onClick={handleClaimAndDownload} className="cursor-pointer flex-1 gap-1.5">
                    <Download className="w-3.5 h-3.5" />
                    Claim & Download
                  </Button>
                </div>
              </>
            )}
            {smartMatchState.step === "claiming" && (
              <div className="py-6 flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
                <p className="text-sm font-medium">Claiming slips & merging PDFs...</p>
                <p className="text-xs text-muted-foreground">This may take a moment</p>
              </div>
            )}
            {smartMatchState.step === "done" && (
              <div className="py-4 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
                  <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="font-medium text-sm">Done!</p>
                  <p className="text-xs text-muted-foreground mt-1">{smartMatchState.count} slip{smartMatchState.count !== 1 ? "s" : ""} claimed & downloaded</p>
                  <p className="text-sm font-semibold mt-1">₨{fmt(smartMatchState.total)}</p>
                </div>
                <Button size="sm" onClick={() => setSmartMatchOpen(false)} className="cursor-pointer w-full">Close</Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {!canClaim && (
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/40 border text-xs text-muted-foreground">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          You have upload-only access — you can upload slips but not claim them.
        </div>
      )}

      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Slip Pool</h3>
        {canClaim && available > 0 && (
          <Button
            size="sm"
            className="cursor-pointer h-7 text-xs gap-1.5 bg-gradient-to-r from-violet-500 to-primary hover:from-violet-600 hover:to-primary/90 text-white border-0 shadow-sm shadow-primary/30"
            onClick={() => setSmartMatchOpen(true)}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Smart Match
          </Button>
        )}
      </div>

      {/* Stats bar */}
      {slips.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-muted/40 border rounded-lg p-3 text-center">
            <p className="text-lg font-bold text-primary truncate">{available}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Available for you</p>
          </div>
          <div className="bg-muted/40 border rounded-lg p-3 text-center">
            <p className="text-lg font-bold truncate">{claimed}</p>
            <p className="text-xs text-muted-foreground mt-0.5">You claimed</p>
          </div>
          <div className="bg-muted/40 border rounded-lg p-3 text-center">
            <p className="text-lg font-bold truncate">
              {totalAmount > 0 ? `₨${fmt(totalAmount)}` : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">Your pool value</p>
          </div>
        </div>
      )}

      {/* Filter tabs + select all */}
      <div className="flex items-center justify-between gap-2">
        <Tabs value={filter} onValueChange={(v) => { setFilter(v as FilterType); clearSelection(); }}>
          <TabsList className="h-8">
            <TabsTrigger value="all" className="text-xs h-6 cursor-pointer">All ({slips.length})</TabsTrigger>
            <TabsTrigger value="available" className="text-xs h-6 cursor-pointer">Available ({available})</TabsTrigger>
            <TabsTrigger value="claimed" className="text-xs h-6 cursor-pointer">Claimed ({claimed})</TabsTrigger>
          </TabsList>
        </Tabs>
        {slips.length > 0 && (
          <button
            onClick={toggleSelectAll}
            className="text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors shrink-0"
          >
            {allSelected ? "Deselect all" : "Select all"}
          </button>
        )}
      </div>

      {/* Slip list */}
      {slips.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><FileText /></EmptyMedia>
            <EmptyTitle>No slips in the pool</EmptyTitle>
            <EmptyDescription>Upload a PDF above to add slips to the shared pool</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-5 pb-20">
          {groupByMonth(slips, (s) => s._creationTime).map((group) => (
            <div key={group.key} className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">{group.label}</p>
              <div className="space-y-2">
                {group.items.map((slip) => (
                  <SlipRow
                    key={slip._id}
                    slip={slip}
                    isAdmin={isAdmin}
                    canClaim={canClaim}
                    isSelected={selectedIds.has(slip._id)}
                    isClaiming={claimingId === slip._id}
                    isEditingAmount={editingAmountId === slip._id}
                    amountInput={amountInput}
                    onToggleSelect={() => toggleSelect(slip._id)}
                    onClaim={() => handleClaim(slip)}
                    onUnclaim={() => handleUnclaim(slip._id)}
                    onStartEdit={() => startEditAmount(slip)}
                    onSaveAmount={() => saveAmount(slip._id)}
                    onCancelEdit={cancelEdit}
                    onAmountInputChange={setAmountInput}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Bulk action bar */}
      {hasSelection && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-background border rounded-xl shadow-lg px-4 py-3">
          <span className="text-sm font-medium mr-1">
            {selectedIds.size} selected
          </span>
          {selectedClaimable.length > 0 && (
            <Button
              size="sm"
              onClick={handleBulkClaim}
              disabled={isBulkProcessing}
              className="cursor-pointer gap-1.5"
            >
              {isBulkProcessing
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Download className="w-3.5 h-3.5" />
              }
              Claim {selectedClaimable.length > 1 ? `${selectedClaimable.length} ` : ""}& Download
            </Button>
          )}
          {isAdmin && selectedUnclaimable.length > 0 && (
            <Button
              size="sm"
              variant="destructive"
              onClick={handleBulkUnclaim}
              disabled={isBulkProcessing}
              className="cursor-pointer gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Unclaim {selectedUnclaimable.length > 1 ? selectedUnclaimable.length : ""}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={clearSelection}
            className="cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

type SlipRowProps = {
  slip: Slip;
  isAdmin: boolean;
  canClaim: boolean;
  isSelected: boolean;
  isClaiming: boolean;
  isEditingAmount: boolean;
  amountInput: string;
  onToggleSelect: () => void;
  onClaim: () => void;
  onUnclaim: () => void;
  onStartEdit: () => void;
  onSaveAmount: () => void;
  onCancelEdit: () => void;
  onAmountInputChange: (v: string) => void;
};

function SlipRow({
  slip, isAdmin, canClaim, isSelected, isClaiming, isEditingAmount,
  amountInput, onToggleSelect, onClaim, onUnclaim, onStartEdit,
  onSaveAmount, onCancelEdit, onAmountInputChange,
}: SlipRowProps) {
  const fileShortName = slip.fileName.replace(/\.pdf$/i, "").slice(0, 18);

  return (
    <div className={cn(
      "flex items-center gap-3 p-3 rounded-lg border transition-colors",
      isSelected
        ? "bg-primary/5 border-primary/30"
        : slip.isClaimedByMe
          ? "bg-muted/20 border-border/50 opacity-70"
          : "bg-card hover:bg-muted/20 border-border"
    )}>
      {/* Checkbox */}
      <Checkbox
        checked={isSelected}
        onCheckedChange={onToggleSelect}
        className="cursor-pointer shrink-0"
      />

      {/* Status icon */}
      <div className={cn(
        "w-8 h-8 rounded-md flex items-center justify-center shrink-0",
        slip.isClaimedByMe ? "bg-muted" : "bg-primary/10"
      )}>
        {slip.isClaimedByMe
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
          {slip.isClaimedByMe && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">Claimed</Badge>
          )}
          {slip.isUsed && (
            <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-muted-foreground">
              Fully used
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          {isEditingAmount ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">₨</span>
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
              <span className="text-xs">₨</span>
              <span>
                {slip.effectiveAmount !== undefined
                  ? slip.effectiveAmount.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
                  : "Set amount"}
              </span>
              <Pencil className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          )}
          {isAdmin && slip.claimedByCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="w-3 h-3" />
              {slip.claimedByCount} claimed
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        {slip.url && (
          <Button
            size="sm"
            variant="outline"
            className="cursor-pointer h-7 text-xs gap-1.5"
            onClick={() => window.open(slip.url!, "_blank")}
          >
            <FileText className="w-3.5 h-3.5" />
            View
          </Button>
        )}
        {!slip.isClaimedByMe && canClaim && (
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
        {slip.isClaimedByMe && slip.url && (
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
        {isAdmin && slip.isClaimedByMe && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="cursor-pointer h-7 w-7 p-0">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={onUnclaim}
                className="cursor-pointer text-xs text-destructive focus:text-destructive"
              >
                <RotateCcw className="w-3.5 h-3.5 mr-2" />
                Unclaim
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}