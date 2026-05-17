import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { toast } from "sonner";
import { ConvexError } from "convex/values";
import { Button } from "@/components/ui/button.tsx";
import { Progress } from "@/components/ui/progress.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog.tsx";
import { Upload, FileText, X, CheckCircle, Loader2, AlertCircle, Image } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { PDFDocument } from "pdf-lib";

type UploadState =
  | { status: "idle" }
  | { status: "converting"; fileName: string }
  | { status: "uploading"; progress: number; fileName: string }
  | { status: "splitting"; fileName: string }
  | { status: "done"; fileName: string; pageCount: number }
  | { status: "error"; message: string };

type Props = {
  groupId: Id<"groups">;
  onComplete?: () => void;
};

const IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic"];

async function convertImageToPdf(file: File): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();
  const imageBytes = await file.arrayBuffer();

  let pdfImage;
  if (file.type === "image/png") {
    pdfImage = await pdfDoc.embedPng(imageBytes);
  } else {
    pdfImage = await pdfDoc.embedJpg(imageBytes);
  }

  const page = pdfDoc.addPage([pdfImage.width, pdfImage.height]);
  page.drawImage(pdfImage, {
    x: 0,
    y: 0,
    width: pdfImage.width,
    height: pdfImage.height,
  });

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
}

export default function PdfUploader({ groupId, onComplete }: Props) {
  const [open, setOpen] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>({ status: "idle" });

  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const saveOpdFile = useMutation(api.files.saveOpdFile);
  const splitPdf = useAction(api.pdfActions.splitPdf);
  const runSmartMatch = useAction(api.amountMatchingAction.runSmartAmountMatching);

  const processFile = useCallback(async (file: File) => {
    const isImage = IMAGE_TYPES.includes(file.type);
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

    // Convert image to PDF
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

      const { pageCount } = await splitPdf({
        fileId,
        groupId,
        storageId: storageId as Id<"_storage">,
      });

      setUploadState({ status: "done", fileName, pageCount });
      toast.success(`Added ${pageCount} slip${pageCount !== 1 ? "s" : ""}!`);
      onComplete?.();

      runSmartMatch({ fileId, groupId }).then((matchResult) => {
        if (matchResult.matched > 0) {
          toast.success(`Smart match: ${matchResult.matched} amount${matchResult.matched !== 1 ? "s" : ""} auto-detected`, {
            description: "OPD amounts extracted from slip PDFs",
          });
        }
      }).catch(() => {});
    } catch (err) {
      const msg = err instanceof ConvexError
        ? (err.data as { message: string }).message
        : "Upload failed. Please try again.";
      setUploadState({ status: "error", message: msg });
      toast.error(msg);
    }
  }, [generateUploadUrl, saveOpdFile, splitPdf, runSmartMatch, groupId, onComplete]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (accepted) => { if (accepted[0]) processFile(accepted[0]); },
    accept: {
      "application/pdf": [".pdf"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
      "image/webp": [".webp"],
    },
    multiple: false,
    disabled: uploadState.status === "uploading" || uploadState.status === "splitting" || uploadState.status === "converting",
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload OPD Document</DialogTitle>
        </DialogHeader>

        <div className="pt-2 space-y-4">
          {uploadState.status === "idle" && (
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
          )}

          {uploadState.status === "converting" && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Image className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{uploadState.fileName}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Converting image to PDF...</p>
                </div>
                <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
              </div>
            </div>
          )}

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
              {uploadState.status === "splitting" && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Extracting individual pages — this may take a moment for large files
                </div>
              )}
            </div>
          )}

          {uploadState.status === "done" && (
            <div className="py-4 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
                <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="font-medium text-sm">Upload complete!</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {uploadState.pageCount} slip{uploadState.pageCount !== 1 ? "s" : ""} added to the pool
                </p>
              </div>
              <div className="flex gap-2 justify-center">
                <Button size="sm" variant="secondary" onClick={reset} className="cursor-pointer">
                  Upload Another
                </Button>
                <Button size="sm" onClick={() => { setOpen(false); reset(); }} className="cursor-pointer">
                  Done
                </Button>
              </div>
            </div>
          )}

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