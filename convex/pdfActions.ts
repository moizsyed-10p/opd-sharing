"use node";

import { action } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { api } from "./_generated/api.js";
import { PDFDocument } from "pdf-lib";

export const splitPdf = action({
  args: {
    fileId: v.id("opdFiles"),
    groupId: v.id("groups"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args): Promise<{ pageCount: number; slipIds: string[]; slipStorageIds: string[] }> => {
    await ctx.runMutation(api.files.updateFileStatus, {
      fileId: args.fileId,
      status: "processing",
    });

    try {
      const url = await ctx.storage.getUrl(args.storageId);
      if (!url) throw new Error("Could not get storage URL");

      const response = await fetch(url);
      const pdfBytes = await response.arrayBuffer();

      const srcPdf = await PDFDocument.load(pdfBytes);
      const pageCount = srcPdf.getPageCount();

      const slipIds: string[] = [];
      const slipStorageIds: string[] = [];

      for (let i = 0; i < pageCount; i++) {
        const singlePagePdf = await PDFDocument.create();
        const [copiedPage] = await singlePagePdf.copyPages(srcPdf, [i]);
        singlePagePdf.addPage(copiedPage);
        const singlePageBytes = await singlePagePdf.save();

        const uploadUrl = await ctx.storage.generateUploadUrl();
        const uploadResponse = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": "application/pdf" },
          body: Buffer.from(singlePageBytes),
        });
        if (!uploadResponse.ok) throw new Error(`Upload failed for page ${i + 1}`);
        const { storageId: slipStorageId } = await uploadResponse.json() as { storageId: string };

        const slipId = await ctx.runMutation(api.files.saveSlip, {
          groupId: args.groupId,
          fileId: args.fileId,
          pageNumber: i + 1,
          storageId: slipStorageId as import("./_generated/dataModel.js").Id<"_storage">,
        });

        slipIds.push(slipId);
        slipStorageIds.push(slipStorageId); // ← add this
      }

      await ctx.runMutation(api.files.updateFileStatus, {
        fileId: args.fileId,
        status: "done",
        pageCount,
      });

      return { pageCount, slipIds, slipStorageIds }; // ← return it
    } catch (err) {
      await ctx.runMutation(api.files.updateFileStatus, {
        fileId: args.fileId,
        status: "error",
      });
      throw new ConvexError({
        message: err instanceof Error ? err.message : "PDF splitting failed",
        code: "EXTERNAL_SERVICE_ERROR",
      });
    }
  },
});