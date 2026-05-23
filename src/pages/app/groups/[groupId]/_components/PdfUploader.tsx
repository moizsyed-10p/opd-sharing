import { useState, useCallback, useRef } from "react";
import { useDropzone } from "react-dropzone";
import { useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { toast } from "sonner";
import { ConvexError } from "convex/values";
import { Button } from "@/components/ui/button.tsx";
import { Progress } from "@/components/ui/progress.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog.tsx";
import { Upload, FileText, CheckCircle, Loader2, AlertCircle, Image, Camera, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { PDFDocument } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

type SlipReview = {
  pageNumber: number;
  detectedAmount: number | null;
  manualAmount: string;
  visionPending?: boolean;
};

type DoneSlip = {
  slipId: string;
  pageNumber: number;
  amount: string;
};

type UploadState =
  | { status: "idle" }
  | { status: "converting"; fileName: string }
  | { status: "extracting"; fileName: string }
  | { status: "review"; fileName: string; uploadFile: Blob; slips: SlipReview[]; uploaded: boolean }
  | { status: "uploading"; progress: number; fileName: string }
  | { status: "splitting"; fileName: string }
  | { status: "ocr"; fileName: string }
  | { status: "done"; fileName: string; pageCount: number; amounts: number[]; visionDetected: number; visionTotal: number; slipAmounts: DoneSlip[] }
  | { status: "error"; message: string };

type Props = {
  groupId: Id<"groups">;
  onComplete?: () => void;
};

const IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

async function convertImageToPdf(file: File): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();
  const imageBytes = await file.arrayBuffer();
  const pdfImage = file.type === "image/png"
    ? await pdfDoc.embedPng(imageBytes)
    : await pdfDoc.embedJpg(imageBytes);
  const page = pdfDoc.addPage([pdfImage.width, pdfImage.height]);
  page.drawImage(pdfImage, { x: 0, y: 0, width: pdfImage.width, height: pdfImage.height });
  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
}

function wordsToNumber(text: string): number | null {
  const words = text.toLowerCase();
  const hundreds = words.match(/(\w+)\s+hundred/);
  if (!hundreds) return null;
  const map: Record<string, number> = {
    one: 100, two: 200, three: 300, four: 400, five: 500,
    six: 600, seven: 700, eight: 800, nine: 900,
  };
  return map[hundreds[1]] ?? null;
}

function extractAmountFromText(text: string): number | null {
  const normalized = text.replace(/\s+/g, " ").trim();

  const labeledPatterns = [
    /(?:grand\s*total|net\s*total|total\s*amount|total\s*payable|total\s*due|total\s*bill)[:\s]+(?:rs\.?|pkr|inr|₹|rupees?)?\s*(\d[\d,]*(?:\.\d{1,2})?)/gi,
    /(?:amount\s*(?:payable|charged|billed|due))[:\s]+(?:rs\.?|pkr|inr|₹)?\s*(\d[\d,]*(?:\.\d{1,2})?)/gi,
    /(?:net\s*amount)[:\s]+(?:rs\.?|pkr|inr|₹)?\s*(\d[\d,]*(?:\.\d{1,2})?)/gi,
    /(?:opd\s*(?:amount|charges?|fee|total|bill))[:\s]+(?:rs\.?|pkr|inr|₹)?\s*(\d[\d,]*(?:\.\d{1,2})?)/gi,
    /(?:bill(?:ed)?\s*(?:amount)?)[:\s]+(?:rs\.?|pkr|inr|₹)?\s*(\d[\d,]*(?:\.\d{1,2})?)/gi,
    /(?:consultation\s*(?:charges?|fee))[:\s]+(?:rs\.?|pkr|inr|₹)?\s*(\d[\d,]*(?:\.\d{1,2})?)/gi,
    /(?:net\s*received)[:\s]+(?:rs\.?|pkr|inr|₹)?\s*(\d[\d,]*(?:\.\d{1,2})?)/gi,
    /(?:gross\s*amount)[:\s]+(?:rs\.?|pkr|inr|₹)?\s*(\d[\d,]*(?:\.\d{1,2})?)/gi,
  ];

  const candidates: number[] = [];
  for (const pattern of labeledPatterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(normalized);
    if (match) {
      const parsed = parseFloat(match[1].replace(/,/g, ""));
      if (!isNaN(parsed) && parsed > 0 && parsed < 1000000) candidates.push(parsed);
    }
  }
  if (candidates.length > 0) return Math.max(...candidates);

  const fallbackPattern = /(?:rs\.?|pkr|inr|₹)\s*(\d[\d,]*(?:\.\d{1,2})?)/gi;
  const fallback: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = fallbackPattern.exec(normalized)) !== null) {
    const parsed = parseFloat(match[1].replace(/,/g, ""));
    if (!isNaN(parsed) && parsed > 0 && parsed < 1000000) fallback.push(parsed);
  }
  if (fallback.length > 0) return Math.max(...fallback);

  const wordsMatch = normalized.match(/amount\s+in\s+words[:\s]+([a-z\s]+)rupees/i);
  if (wordsMatch) {
    const fromWords = wordsToNumber(wordsMatch[1]);
    if (fromWords) return fromWords;
  }

  return null;
}

async function extractAmountsFromPdf(pdfBuffer: ArrayBuffer): Promise<number[]> {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) }).promise;
  const amounts: number[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    amounts.push(extractAmountFromText(text) ?? 0);
  }

  return amounts;
}

export default function PdfUploader({ groupId, onComplete }: Props) {
  const [open, setOpen] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>({ status: "idle" });
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const saveOpdFile = useMutation(api.files.saveOpdFile);
  const splitPdf = useAction(api.pdfActions.splitPdf);
  const saveSlipAmounts = useMutation(api.slips.saveExtractedAmounts);
  const extractAmountFromImage = useAction(api.amountMatchingAction.extractAmountFromImage);

  const processFile = useCallback(async (file: File) => {
    const isImage = IMAGE_TYPES.includes(file.type) || file.type.startsWith("image/");
    const isPdf = file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";

    if (!isImage && !isPdf) {
      toast.error("Only PDF or image files (JPG, PNG, WEBP) are supported");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast.error("File too large. Maximum size is 50MB.");
      return;
    }

    let uploadFile: Blob = file;
    let fileName = file.name;

    if (isImage) {
      setUploadState({ status: "converting", fileName: file.name });
      try {
        uploadFile = await convertImageToPdf(file);
        fileName = file.name.replace(/\.[^/.]+$/, "") + ".pdf";
      } catch {
        setUploadState({ status: "error", message: "Failed to convert image to PDF" });
        return;
      }
    }

    setUploadState({ status: "extracting", fileName });
    let extractedAmounts: number[] = [];
    try {
      const buffer = await uploadFile.arrayBuffer();
      extractedAmounts = await extractAmountsFromPdf(buffer);
    } catch {
      extractedAmounts = [];
    }

    const pdf = await pdfjsLib.getDocument({
      data: new Uint8Array(await uploadFile.arrayBuffer()),
    }).promise;
    const pageCount = pdf.numPages;

    const slips: SlipReview[] = Array.from({ length: pageCount }, (_, i) => ({
      pageNumber: i + 1,
      detectedAmount: extractedAmounts[i] > 0 ? extractedAmounts[i] : null,
      manualAmount: extractedAmounts[i] > 0 ? extractedAmounts[i].toString() : "",
      visionPending: extractedAmounts[i] === 0,
    }));

    setUploadState({ status: "review", fileName, uploadFile, slips, uploaded: false });
  }, []);

  const handleConfirmAmounts = useCallback(async () => {
    if (uploadState.status !== "review") return;
    const { fileName, uploadFile, slips } = uploadState;

    const manualAmounts = slips.map((s) => {
      const parsed = parseFloat(s.manualAmount);
      return isNaN(parsed) ? 0 : parsed;
    });

    setUploadState({ status: "uploading", progress: 10, fileName });

    try {
      const uploadUrl = await generateUploadUrl();
      setUploadState({ status: "uploading", progress: 30, fileName });

      const result = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: uploadFile,
      });
      if (!result.ok) throw new Error("Upload failed");
      const { storageId } = await result.json() as { storageId: string };
      setUploadState({ status: "uploading", progress: 70, fileName });

      const fileId = await saveOpdFile({
        groupId,
        storageId: storageId as Id<"_storage">,
        originalName: fileName,
      });

      setUploadState({ status: "splitting", fileName });
      const { pageCount, slipIds, slipStorageIds } = await splitPdf({
        fileId,
        groupId,
        storageId: storageId as Id<"_storage">,
      });

      // Save manually entered amounts
      const knownAmounts = slipIds
        .map((slipId, i) => ({ slipId: slipId as Id<"opdSlips">, amount: manualAmounts[i] ?? 0 }))
        .filter((e) => e.amount > 0);

      if (knownAmounts.length > 0) {
        await saveSlipAmounts({ amounts: knownAmounts });
      }

      // Run Vision for pages where user left amount empty
      const needsVision = slips
        .map((s, i) => ({ index: i, slip: s }))
        .filter(({ slip, index }) => !slip.manualAmount && slipStorageIds[index]);

      let visionDetected = 0;
      const visionTotal = needsVision.length;
      const visionAmountMap = new Map<string, number>();

      if (needsVision.length > 0) {
        setUploadState({ status: "ocr", fileName });

        const visionResults = await Promise.all(
          needsVision.map(async ({ index }) => {
            const amount = await extractAmountFromImage({
              storageId: slipStorageIds[index],
            });
            if (amount && amount > 0) {
              visionDetected++;
              visionAmountMap.set(slipIds[index], amount);
            }
            return {
              slipId: slipIds[index] as Id<"opdSlips">,
              amount: amount ?? 0,
            };
          })
        );

        const visionAmounts = visionResults.filter((r) => r.amount > 0);
        if (visionAmounts.length > 0) {
          await saveSlipAmounts({ amounts: visionAmounts });
        }
      }

      // Build slip amounts for done screen
      const slipAmounts: DoneSlip[] = slipIds.map((slipId, i) => {
        const manual = manualAmounts[i] ?? 0;
        const vision = visionAmountMap.get(slipId) ?? 0;
        const final = manual > 0 ? manual : vision;
        return {
          slipId,
          pageNumber: i + 1,
          amount: final > 0 ? final.toString() : "",
        };
      });

      setUploadState({
        status: "done",
        fileName,
        pageCount,
        amounts: knownAmounts.map((a) => a.amount).filter((a) => a > 0),
        visionDetected,
        visionTotal,
        slipAmounts,
      });

      toast.success(`Added ${pageCount} slip${pageCount !== 1 ? "s" : ""}!`);
      onComplete?.();

    } catch (err) {
      const msg = err instanceof ConvexError
        ? (err.data as { message: string }).message
        : "Upload failed. Please try again.";
      setUploadState({ status: "error", message: msg });
      toast.error(msg);
    }
  }, [uploadState, generateUploadUrl, saveOpdFile, splitPdf, saveSlipAmounts, extractAmountFromImage, groupId, onComplete]);

  const updateSlipAmount = (pageNumber: number, value: string) => {
    if (uploadState.status !== "review") return;
    setUploadState({
      ...uploadState,
      slips: uploadState.slips.map((s) =>
        s.pageNumber === pageNumber ? { ...s, manualAmount: value, visionPending: !value } : s
      ),
    });
  };

  const updateDoneSlipAmount = (slipId: string, value: string) => {
    if (uploadState.status !== "done") return;
    setUploadState({
      ...uploadState,
      slipAmounts: uploadState.slipAmounts.map((s) =>
        s.slipId === slipId ? { ...s, amount: value } : s
      ),
    });
  };

  const handleFinalSave = useCallback(async () => {
    if (uploadState.status !== "done") return;
    const { slipAmounts } = uploadState;

    const toSave = slipAmounts
      .map((s) => ({ slipId: s.slipId as Id<"opdSlips">, amount: parseFloat(s.amount) }))
      .filter((s) => !isNaN(s.amount) && s.amount > 0);

    try {
      if (toSave.length > 0) {
        await saveSlipAmounts({ amounts: toSave });
      }
      setOpen(false);
      reset();
    } catch {
      toast.error("Failed to save amounts");
    }
  }, [uploadState, saveSlipAmounts]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (accepted) => { if (accepted[0]) processFile(accepted[0]); },
    accept: {
      "application/pdf": [".pdf"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
      "image/webp": [".webp"],
    },
    multiple: false,
    disabled: ["uploading", "splitting", "converting", "extracting", "review", "ocr"].includes(uploadState.status),
  });

  const reset = () => setUploadState({ status: "idle" });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" className="cursor-pointer">
          <Upload className="w-4 h-4 mr-2" />
          Upload
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload OPD Document</DialogTitle>
        </DialogHeader>

        <div className="pt-2 space-y-4">

          {/* IDLE */}
          {uploadState.status === "idle" && (
            <>
              <div
                {...getRootProps()}
                className={cn(
                  "border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors",
                  isDragActive
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50 hover:bg-muted/30"
                )}
              >
                <input {...getInputProps()} />
                <div className="flex flex-col items-center gap-3">
                  <div className="flex gap-2">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                      <FileText className="w-6 h-6 text-primary" />
                    </div>
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Image className="w-6 h-6 text-primary" />
                    </div>
                  </div>
                  <div>
                    <p className="font-medium text-sm">
                      {isDragActive ? "Drop file here" : "Drag & drop a PDF or image"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      PDF, JPG, PNG, WEBP — max 50MB
                    </p>
                  </div>
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">or</span>
                </div>
              </div>

              <Button
                variant="outline"
                className="w-full cursor-pointer gap-2"
                onClick={() => cameraInputRef.current?.click()}
              >
                <Camera className="w-4 h-4" />
                Take a Photo
              </Button>

              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) processFile(file);
                  e.target.value = "";
                }}
              />
            </>
          )}

          {/* CONVERTING */}
          {uploadState.status === "converting" && (
            <div className="py-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Image className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{uploadState.fileName}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Converting image to PDF...</p>
              </div>
              <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
            </div>
          )}

          {/* EXTRACTING */}
          {uploadState.status === "extracting" && (
            <div className="py-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{uploadState.fileName}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Reading receipt amounts...</p>
              </div>
              <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
            </div>
          )}

          {/* REVIEW */}
          {uploadState.status === "review" && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium">{uploadState.fileName}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Review detected amounts. Empty fields will be scanned automatically after upload.
                </p>
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {uploadState.slips.map((slip) => (
                  <div
                    key={slip.pageNumber}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-lg border",
                      slip.detectedAmount === null
                        ? "border-amber-500/30 bg-amber-500/5"
                        : "border-border bg-muted/20"
                    )}
                  >
                    <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs font-medium">Page {slip.pageNumber}</p>
                        {slip.detectedAmount === null && !slip.manualAmount && (
                          <span className="flex items-center gap-0.5 text-[10px] text-amber-600">
                            <AlertTriangle className="w-3 h-3" />
                            Will scan automatically
                          </span>
                        )}
                        {slip.detectedAmount !== null && (
                          <span className="text-[10px] text-green-600">Auto-detected</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-xs text-muted-foreground">₨</span>
                      <Input
                        type="number"
                        min="0"
                        placeholder="auto"
                        value={slip.manualAmount}
                        onChange={(e) => updateSlipAmount(slip.pageNumber, e.target.value)}
                        className="h-7 w-24 text-xs px-2"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={reset} className="cursor-pointer">
                  Cancel
                </Button>
                <Button size="sm" onClick={handleConfirmAmounts} className="cursor-pointer flex-1">
                  Confirm & Upload
                </Button>
              </div>
            </div>
          )}

          {/* UPLOADING / SPLITTING */}
          {(uploadState.status === "uploading" || uploadState.status === "splitting") && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{uploadState.fileName}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {uploadState.status === "uploading" ? "Uploading..." : "Splitting pages..."}
                  </p>
                </div>
                <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
              </div>
              {uploadState.status === "uploading" && (
                <Progress value={uploadState.progress} className="h-1.5" />
              )}
            </div>
          )}

          {/* OCR */}
          {uploadState.status === "ocr" && (
            <div className="py-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{uploadState.fileName}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Scanning receipts for amounts...</p>
              </div>
              <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
            </div>
          )}

          {/* DONE */}
          {uploadState.status === "done" && (
            <div className="py-2 space-y-4">
              <div className="text-center space-y-2">
                <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
                  <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400" />
                </div>
                <p className="font-medium text-sm">Upload complete!</p>
                <p className="text-xs text-muted-foreground">
                  {uploadState.pageCount} slip{uploadState.pageCount !== 1 ? "s" : ""} added
                </p>
                {uploadState.visionTotal > 0 && (
                  <p className={cn(
                    "text-xs",
                    uploadState.visionDetected > 0 ? "text-green-600" : "text-amber-600"
                  )}>
                    {uploadState.visionDetected > 0
                      ? `✓ Vision scanned ${uploadState.visionDetected} of ${uploadState.visionTotal} page${uploadState.visionTotal !== 1 ? "s" : ""} successfully`
                      : `Vision could not detect amounts — enter them below`
                    }
                  </p>
                )}
              </div>

              {/* Editable slip amounts */}
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {uploadState.slipAmounts.map((slip) => (
                  <div
                    key={slip.slipId}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-lg border",
                      !slip.amount
                        ? "border-amber-500/30 bg-amber-500/5"
                        : "border-border bg-muted/20"
                    )}
                  >
                    <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs font-medium">Page {slip.pageNumber}</p>
                        {!slip.amount && (
                          <span className="flex items-center gap-0.5 text-[10px] text-amber-600">
                            <AlertTriangle className="w-3 h-3" />
                            Missing
                          </span>
                        )}
                        {slip.amount && (
                          <span className="text-[10px] text-green-600">Detected</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-xs text-muted-foreground">₨</span>
                      <Input
                        type="number"
                        min="0"
                        placeholder="Enter amount"
                        value={slip.amount}
                        onChange={(e) => updateDoneSlipAmount(slip.slipId, e.target.value)}
                        className="h-7 w-28 text-xs px-2"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={reset} className="cursor-pointer">
                  Upload Another
                </Button>
                <Button size="sm" onClick={handleFinalSave} className="cursor-pointer flex-1">
                  Save & Done
                </Button>
              </div>
            </div>
          )}

          {/* ERROR */}
          {uploadState.status === "error" && (
            <div className="py-4 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6 text-destructive" />
              </div>
              <div>
                <p className="font-medium text-sm">Upload failed</p>
                <p className="text-xs text-muted-foreground mt-1">{uploadState.message}</p>
              </div>
              <Button size="sm" onClick={reset} className="cursor-pointer">
                Try Again
              </Button>
            </div>
          )}

        </div>
      </DialogContent>
    </Dialog>
  );
}