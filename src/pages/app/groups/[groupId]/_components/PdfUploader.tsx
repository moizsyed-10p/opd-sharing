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
import { Upload, FileText, CheckCircle, Loader2, AlertCircle, Image, Camera, AlertTriangle, ChevronLeft, ChevronRight, Crop } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { PDFDocument } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
import ReactCrop, { type Crop as CropType, centerCrop, makeAspectCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

type SlipReview = {
  pageNumber: number;
  detectedAmount: number | null;
  manualAmount: string;
  visionPending?: boolean;
  fileName: string;
};

type DoneSlip = {
  slipId: string;
  pageNumber: number;
  amount: string;
  fileName: string;
};

// One item to crop — could be from camera or file picker
type CropItem = {
  file: File;
  objectUrl: string;
  crop: CropType | undefined;
  croppedBlob: Blob | null; // null = not yet cropped / skipped
  skipped: boolean;
};

type UploadState =
  | { status: "idle" }
  | { status: "crop"; items: CropItem[]; currentIndex: number }
  | { status: "converting"; fileName: string; current: number; total: number }
  | { status: "extracting"; fileName: string; current: number; total: number }
  | { status: "review"; files: Array<{ fileName: string; uploadFile: Blob; slips: SlipReview[] }> }
  | { status: "uploading"; progress: number; fileName: string; current: number; total: number }
  | { status: "splitting"; fileName: string; current: number; total: number }
  | { status: "ocr"; fileName: string }
  | { status: "done"; totalSlips: number; visionDetected: number; visionTotal: number; slipAmounts: DoneSlip[] }
  | { status: "error"; message: string };

type Props = {
  groupId: Id<"groups">;
  onComplete?: () => void;
};

const IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

async function compressImage(blob: Blob, mimeType: string): Promise<Blob> {
  return new Promise((resolve) => {
    const img = document.createElement("img");
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);

      const MAX = 1800;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        if (width > height) {
          height = Math.round((height * MAX) / width);
          width = MAX;
        } else {
          width = Math.round((width * MAX) / height);
          height = MAX;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (compressed) => resolve(compressed ?? blob),
        "image/jpeg",
        0.80
      );
    };
    img.src = url;
  });
}

async function convertImageToPdf(blob: Blob, mimeType: string): Promise<Blob> {
  const compressed = await compressImage(blob, mimeType);
  const pdfDoc = await PDFDocument.create();
  const imageBytes = await blob.arrayBuffer();
  // Always JPEG after compression
  // const pdfImage = await pdfDoc.embedJpg(imageBytes);
  const pdfImage = mimeType === "image/png"
    ? await pdfDoc.embedPng(imageBytes)
    : await pdfDoc.embedJpg(imageBytes);
  const page = pdfDoc.addPage([pdfImage.width, pdfImage.height]);
  page.drawImage(pdfImage, { x: 0, y: 0, width: pdfImage.width, height: pdfImage.height });
  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
}

async function cropImageToBlob(
  imageEl: HTMLImageElement,
  crop: CropType,
  mimeType: string
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const scaleX = imageEl.naturalWidth / imageEl.width;
  const scaleY = imageEl.naturalHeight / imageEl.height;
  canvas.width = crop.width * scaleX;
  canvas.height = crop.height * scaleY;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(
    imageEl,
    crop.x * scaleX,
    crop.y * scaleY,
    crop.width * scaleX,
    crop.height * scaleY,
    0, 0,
    canvas.width,
    canvas.height
  );
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), mimeType ?? "image/jpeg", 0.95));
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
    const text = textContent.items.map((item) => ("str" in item ? item.str : "")).join(" ");
    amounts.push(extractAmountFromText(text) ?? 0);
  }
  return amounts;
}

function getFileName(file: File): string {
  const isUUID = /^[0-9a-f-]{36}$/i.test(file.name.replace(/\.[^/.]+$/, ""));
  const baseName = isUUID
    ? `receipt-${new Date().toLocaleDateString("en-PK").replace(/\//g, "-")}`
    : file.name.replace(/\.[^/.]+$/, "");
  return baseName;
}

export default function PdfUploader({ groupId, onComplete }: Props) {
  const [open, setOpen] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>({ status: "idle" });
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const cropImageRef = useRef<HTMLImageElement>(null);

  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const saveOpdFile = useMutation(api.files.saveOpdFile);
  const splitPdf = useAction(api.pdfActions.splitPdf);
  const saveSlipAmounts = useMutation(api.slips.saveExtractedAmounts);
  const extractAmountFromImage = useAction(api.amountMatchingAction.extractAmountFromImage);

  // ─── Crop helpers ───────────────────────────────────────────
  const updateCropItem = (index: number, patch: Partial<CropItem>) => {
    setUploadState((prev) => {
      if (prev.status !== "crop") return prev;
      const items = prev.items.map((item, i) => i === index ? { ...item, ...patch } : item);
      return { ...prev, items };
    });
  };

  const handleCropChange = (crop: CropType) => {
    if (uploadState.status !== "crop") return;
    updateCropItem(uploadState.currentIndex, { crop });
  };

  const handleApplyCrop = async () => {
    if (uploadState.status !== "crop") return;
    const item = uploadState.items[uploadState.currentIndex];
    if (!cropImageRef.current || !item.crop || item.crop.width === 0) {
      // No crop drawn — treat as skip
      handleSkipCrop();
      return;
    }
    const blob = await cropImageToBlob(cropImageRef.current, item.crop, item.file.type);
    updateCropItem(uploadState.currentIndex, { croppedBlob: blob, skipped: false });
    goNextCrop();
  };

  const handleSkipCrop = () => {
    if (uploadState.status !== "crop") return;
    updateCropItem(uploadState.currentIndex, { skipped: true, croppedBlob: null });
    goNextCrop();
  };

  const goNextCrop = () => {
    setUploadState((prev) => {
      if (prev.status !== "crop") return prev;
      const next = prev.currentIndex + 1;
      if (next >= prev.items.length) {
        // All done — proceed to processing
        processCroppedItems(prev.items);
        return prev; // processCroppedItems will set new state
      }
      return { ...prev, currentIndex: next };
    });
  };

  const goPrevCrop = () => {
    setUploadState((prev) => {
      if (prev.status !== "crop") return prev;
      return { ...prev, currentIndex: Math.max(0, prev.currentIndex - 1) };
    });
  };

  // ─── Process files after crop ────────────────────────────────
  const processCroppedItems = useCallback(async (items: CropItem[]) => {
    const reviewFiles: Array<{ fileName: string; uploadFile: Blob; slips: SlipReview[] }> = [];

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      const baseName = getFileName(item.file);
      const fileName = baseName + ".pdf";

      setUploadState({
        status: "converting",
        fileName,
        current: idx + 1,
        total: items.length,
      });

      let sourceBlob: Blob = item.skipped || !item.croppedBlob ? item.file : item.croppedBlob;
      const uploadFile = await convertImageToPdf(sourceBlob, item.file.type);

      setUploadState({
        status: "extracting",
        fileName,
        current: idx + 1,
        total: items.length,
      });

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
        fileName,
      }));

      reviewFiles.push({ fileName, uploadFile, slips });

      // Cleanup object URL
      URL.revokeObjectURL(item.objectUrl);
    }

    setUploadState({ status: "review", files: reviewFiles });
  }, []);

  // ─── Process PDFs (no crop needed) ──────────────────────────
  const processPdfFiles = useCallback(async (files: File[]) => {
    const reviewFiles: Array<{ fileName: string; uploadFile: Blob; slips: SlipReview[] }> = [];

    for (let idx = 0; idx < files.length; idx++) {
      const file = files[idx];
      const fileName = file.name;

      setUploadState({
        status: "extracting",
        fileName,
        current: idx + 1,
        total: files.length,
      });

      let extractedAmounts: number[] = [];
      try {
        const buffer = await file.arrayBuffer();
        extractedAmounts = await extractAmountsFromPdf(buffer);
      } catch {
        extractedAmounts = [];
      }

      const pdf = await pdfjsLib.getDocument({
        data: new Uint8Array(await file.arrayBuffer()),
      }).promise;
      const pageCount = pdf.numPages;

      const slips: SlipReview[] = Array.from({ length: pageCount }, (_, i) => ({
        pageNumber: i + 1,
        detectedAmount: extractedAmounts[i] > 0 ? extractedAmounts[i] : null,
        manualAmount: extractedAmounts[i] > 0 ? extractedAmounts[i].toString() : "",
        visionPending: extractedAmounts[i] === 0,
        fileName,
      }));

      reviewFiles.push({ fileName, uploadFile: file, slips });
    }

    setUploadState({ status: "review", files: reviewFiles });
  }, []);

  // ─── Main drop handler ───────────────────────────────────────
  const onDrop = useCallback((accepted: File[]) => {
    if (accepted.length === 0) return;

    const images = accepted.filter((f) => IMAGE_TYPES.includes(f.type) || f.type.startsWith("image/"));
    const pdfs = accepted.filter((f) => f.name.toLowerCase().endsWith(".pdf") || f.type === "application/pdf");

    if (images.length > 0 && pdfs.length === 0) {
      // All images — go to crop flow
      const items: CropItem[] = images.map((file) => ({
        file,
        objectUrl: URL.createObjectURL(file),
        crop: undefined,
        croppedBlob: null,
        skipped: false,
      }));
      setUploadState({ status: "crop", items, currentIndex: 0 });
    } else if (pdfs.length > 0 && images.length === 0) {
      // All PDFs
      processPdfFiles(pdfs);
    } else {
      // Mixed — process separately, images first then PDFs
      toast.info("Processing images and PDFs separately");
      const items: CropItem[] = images.map((file) => ({
        file,
        objectUrl: URL.createObjectURL(file),
        crop: undefined,
        croppedBlob: null,
        skipped: false,
      }));
      setUploadState({ status: "crop", items, currentIndex: 0 });
      // PDFs will be handled after crop flow completes — for simplicity, only handle images first
      // TODO: queue PDFs after images if mixed
    }
  }, [processPdfFiles]);

  // ─── Camera handler ──────────────────────────────────────────
  const handleCameraCapture = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const items: CropItem[] = [{
      file,
      objectUrl: URL.createObjectURL(file),
      crop: undefined,
      croppedBlob: null,
      skipped: false,
    }];
    setUploadState({ status: "crop", items, currentIndex: 0 });
  }, []);

  // ─── Upload all files from review ───────────────────────────
  const handleConfirmAmounts = useCallback(async () => {
    if (uploadState.status !== "review") return;
    const { files } = uploadState;

    const allSlipAmounts: DoneSlip[] = [];
    let totalSlips = 0;
    let totalVisionDetected = 0;
    let totalVisionTotal = 0;

    for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
      const { fileName, uploadFile, slips } = files[fileIdx];

      const manualAmounts = slips.map((s) => {
        const parsed = parseFloat(s.manualAmount);
        return isNaN(parsed) ? 0 : parsed;
      });

      setUploadState({
        status: "uploading",
        progress: 10,
        fileName,
        current: fileIdx + 1,
        total: files.length,
      });

      try {
        const uploadUrl = await generateUploadUrl();
        setUploadState({ status: "uploading", progress: 30, fileName, current: fileIdx + 1, total: files.length });

        const result = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": "application/pdf" },
          body: uploadFile,
        });
        if (!result.ok) throw new Error("Upload failed");
        const { storageId } = await result.json() as { storageId: string };
        setUploadState({ status: "uploading", progress: 70, fileName, current: fileIdx + 1, total: files.length });

        const fileId = await saveOpdFile({
          groupId,
          storageId: storageId as Id<"_storage">,
          originalName: fileName,
        });

        setUploadState({ status: "splitting", fileName, current: fileIdx + 1, total: files.length });
        const { pageCount, slipIds, slipStorageIds } = await splitPdf({
          fileId,
          groupId,
          storageId: storageId as Id<"_storage">,
        });

        totalSlips += pageCount;

        const knownAmounts = slipIds
          .map((slipId, i) => ({ slipId: slipId as Id<"opdSlips">, amount: manualAmounts[i] ?? 0 }))
          .filter((e) => e.amount > 0);

        if (knownAmounts.length > 0) {
          await saveSlipAmounts({ amounts: knownAmounts });
        }

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
              const amount = await extractAmountFromImage({ storageId: slipStorageIds[index] });
              if (amount && amount > 0) {
                visionDetected++;
                visionAmountMap.set(slipIds[index], amount);
              }
              return { slipId: slipIds[index] as Id<"opdSlips">, amount: amount ?? 0 };
            })
          );
          const visionAmounts = visionResults.filter((r) => r.amount > 0);
          if (visionAmounts.length > 0) {
            await saveSlipAmounts({ amounts: visionAmounts });
          }
        }

        totalVisionDetected += visionDetected;
        totalVisionTotal += visionTotal;

        slipIds.forEach((slipId, i) => {
          const manual = manualAmounts[i] ?? 0;
          const vision = visionAmountMap.get(slipId) ?? 0;
          const final = manual > 0 ? manual : vision;
          allSlipAmounts.push({
            slipId,
            pageNumber: i + 1,
            amount: final > 0 ? final.toString() : "",
            fileName,
          });
        });

      } catch (err) {
        const msg = err instanceof ConvexError
          ? (err.data as { message: string }).message
          : `Failed to upload ${fileName}`;
        toast.error(msg);
      }
    }

    setUploadState({
      status: "done",
      totalSlips,
      visionDetected: totalVisionDetected,
      visionTotal: totalVisionTotal,
      slipAmounts: allSlipAmounts,
    });

    toast.success(`Added ${totalSlips} slip${totalSlips !== 1 ? "s" : ""}!`);
    onComplete?.();
  }, [uploadState, generateUploadUrl, saveOpdFile, splitPdf, saveSlipAmounts, extractAmountFromImage, groupId, onComplete]);

  const updateSlipAmount = (fileName: string, pageNumber: number, value: string) => {
    if (uploadState.status !== "review") return;
    setUploadState({
      ...uploadState,
      files: uploadState.files.map((f) =>
        f.fileName === fileName
          ? {
            ...f,
            slips: f.slips.map((s) =>
              s.pageNumber === pageNumber ? { ...s, manualAmount: value, visionPending: !value } : s
            ),
          }
          : f
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
    const toSave = uploadState.slipAmounts
      .map((s) => ({ slipId: s.slipId as Id<"opdSlips">, amount: parseFloat(s.amount) }))
      .filter((s) => !isNaN(s.amount) && s.amount > 0);
    try {
      if (toSave.length > 0) await saveSlipAmounts({ amounts: toSave });
      setOpen(false);
      reset();
    } catch {
      toast.error("Failed to save amounts");
    }
  }, [uploadState, saveSlipAmounts]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
      "image/webp": [".webp"],
    },
    multiple: true,
    disabled: uploadState.status !== "idle",
  });

  const reset = () => setUploadState({ status: "idle" });

  const isProcessing = ["uploading", "splitting", "converting", "extracting", "ocr"].includes(uploadState.status);

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
                  "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors",
                  isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"
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
                      {isDragActive ? "Drop files here" : "Drag & drop PDFs or images"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Multiple files supported — PDF, JPG, PNG, WEBP — max 50MB each
                    </p>
                  </div>
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
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
                onChange={(e) => { handleCameraCapture(e.target.files); e.target.value = ""; }}
              />
            </>
          )}

          {/* CROP */}
          {uploadState.status === "crop" && (() => {
            const item = uploadState.items[uploadState.currentIndex];
            const total = uploadState.items.length;
            const current = uploadState.currentIndex + 1;
            return (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Crop Image</p>
                    <p className="text-xs text-muted-foreground">
                      {current} of {total} — {item.file.name.slice(0, 20)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 cursor-pointer"
                      onClick={goPrevCrop}
                      disabled={uploadState.currentIndex === 0}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="text-xs text-muted-foreground">{current}/{total}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 cursor-pointer"
                      onClick={goNextCrop}
                      disabled={uploadState.currentIndex === total - 1}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* Progress dots */}
                {total > 1 && (
                  <div className="flex justify-center gap-1.5">
                    {uploadState.items.map((it, i) => (
                      <div
                        key={i}
                        className={cn(
                          "w-2 h-2 rounded-full transition-colors",
                          i === uploadState.currentIndex
                            ? "bg-primary"
                            : it.skipped
                              ? "bg-muted-foreground/40"
                              : it.croppedBlob
                                ? "bg-green-500"
                                : "bg-border"
                        )}
                      />
                    ))}
                  </div>
                )}

                <div className="rounded-lg overflow-hidden border bg-muted/20 max-h-72 flex items-center justify-center">
                  <ReactCrop
                    crop={item.crop}
                    onChange={handleCropChange}
                    style={{ maxHeight: "280px" }}
                  >
                    <img
                      ref={cropImageRef}
                      src={item.objectUrl}
                      alt="Crop preview"
                      style={{ maxHeight: "280px", objectFit: "contain" }}
                    />
                  </ReactCrop>
                </div>

                <p className="text-xs text-muted-foreground text-center">
                  Draw a selection to crop, or skip to use the full image
                </p>

                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={reset} className="cursor-pointer">
                    Cancel
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleSkipCrop} className="cursor-pointer">
                    Skip
                  </Button>
                  <Button size="sm" onClick={handleApplyCrop} className="cursor-pointer flex-1 gap-1.5">
                    <Crop className="w-3.5 h-3.5" />
                    {current === total ? "Done" : "Apply & Next"}
                  </Button>
                </div>
              </div>
            );
          })()}

          {/* CONVERTING */}
          {uploadState.status === "converting" && (
            <div className="py-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Image className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{uploadState.fileName}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Converting image {uploadState.current} of {uploadState.total}...
                </p>
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
                <p className="text-xs text-muted-foreground mt-0.5">
                  Reading amounts — file {uploadState.current} of {uploadState.total}
                </p>
              </div>
              <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
            </div>
          )}

          {/* REVIEW */}
          {uploadState.status === "review" && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium">
                  {uploadState.files.length} file{uploadState.files.length !== 1 ? "s" : ""} ready
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Review amounts. Empty fields will be scanned automatically after upload.
                </p>
              </div>

              <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                {uploadState.files.map((file) => (
                  <div key={file.fileName} className="space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground truncate">
                      📄 {file.fileName.slice(0, 25)}
                    </p>
                    {file.slips.map((slip) => (
                      <div
                        key={`${file.fileName}-${slip.pageNumber}`}
                        className={cn(
                          "flex items-center gap-3 p-2.5 rounded-lg border",
                          slip.detectedAmount === null ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-muted/20"
                        )}
                      >
                        <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                          <FileText className="w-3.5 h-3.5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs font-medium">Page {slip.pageNumber}</p>
                            {slip.detectedAmount === null && !slip.manualAmount && (
                              <span className="flex items-center gap-0.5 text-[10px] text-amber-600">
                                <AlertTriangle className="w-2.5 h-2.5" />
                                Will scan
                              </span>
                            )}
                            {slip.detectedAmount !== null && (
                              <span className="text-[10px] text-green-600">Detected</span>
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
                            onChange={(e) => updateSlipAmount(file.fileName, slip.pageNumber, e.target.value)}
                            className="h-7 w-24 text-xs px-2"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={reset} className="cursor-pointer">Cancel</Button>
                <Button size="sm" onClick={handleConfirmAmounts} className="cursor-pointer flex-1">
                  Confirm & Upload All
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
                    {uploadState.status === "uploading" ? "Uploading" : "Splitting"} — file {uploadState.current} of {uploadState.total}
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
                  {uploadState.totalSlips} slip{uploadState.totalSlips !== 1 ? "s" : ""} added
                </p>
                {uploadState.visionTotal > 0 && (
                  <p className={cn("text-xs", uploadState.visionDetected > 0 ? "text-green-600" : "text-amber-600")}>
                    {uploadState.visionDetected > 0
                      ? `✓ Vision scanned ${uploadState.visionDetected} of ${uploadState.visionTotal} pages`
                      : `Vision could not detect amounts — enter them below`}
                  </p>
                )}
              </div>

              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {uploadState.slipAmounts.map((slip) => (
                  <div
                    key={slip.slipId}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-lg border",
                      !slip.amount ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-muted/20"
                    )}
                  >
                    <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{slip.fileName.slice(0, 15)} — Page {slip.pageNumber}</p>
                      {!slip.amount && (
                        <span className="flex items-center gap-0.5 text-[10px] text-amber-600">
                          <AlertTriangle className="w-3 h-3" />Missing
                        </span>
                      )}
                      {slip.amount && <span className="text-[10px] text-green-600">Detected</span>}
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
                <Button size="sm" variant="secondary" onClick={reset} className="cursor-pointer">Upload Another</Button>
                <Button size="sm" onClick={handleFinalSave} className="cursor-pointer flex-1">Save & Done</Button>
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
              <Button size="sm" onClick={reset} className="cursor-pointer">Try Again</Button>
            </div>
          )}

        </div>
      </DialogContent>
    </Dialog>
  );
}