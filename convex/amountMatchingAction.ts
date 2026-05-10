"use node";

import { action, internalAction } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { api, internal } from "./_generated/api.js";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import type { Id } from "./_generated/dataModel.d.ts";

// Disable worker for Node.js environment
pdfjsLib.GlobalWorkerOptions.workerSrc = "";

/**
 * Extract text from a PDF buffer using pdf.js
 */
async function extractTextFromPdf(pdfBuffer: ArrayBuffer): Promise<string> {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    useWorkerFetch: false,
    useSystemFonts: true,
    disableFontFace: true,
  });

  const pdf = await loadingTask.promise;
  const texts: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => {
        if ("str" in item) return item.str;
        return "";
      })
      .join(" ");
    texts.push(pageText);
  }

  return texts.join("\n");
}

/**
 * Parse amount from text using multiple regex patterns common in OPD slips.
 * Looks for INR / Rs. / ₹ patterns and common OPD label keywords.
 */
function extractAmountFromText(text: string): number | null {
  // Normalize: remove extra spaces, lowercase for keyword matching
  const normalized = text.replace(/\s+/g, " ").trim();

  // Priority patterns — labeled amounts near OPD keywords
  const labeledPatterns = [
    // "OPD Amount: 500" or "OPD Charges: ₹500"
    /(?:opd\s*(?:amount|charge[s]?|fee[s]?|total|bill)[:\s]+)(?:rs\.?|inr|₹)?\s*(\d[\d,]*(?:\.\d{1,2})?)/gi,
    // "Total Amount: ₹500" or "Amount: 500.00"
    /(?:total\s*(?:amount|charge[s]?|fee[s]?)[:\s]+)(?:rs\.?|inr|₹)?\s*(\d[\d,]*(?:\.\d{1,2})?)/gi,
    // "Amount Payable: 500"
    /(?:amount\s*(?:payable|charged|billed)[:\s]+)(?:rs\.?|inr|₹)?\s*(\d[\d,]*(?:\.\d{1,2})?)/gi,
    // "Net Amount: ₹500"
    /(?:net\s*amount[:\s]+)(?:rs\.?|inr|₹)?\s*(\d[\d,]*(?:\.\d{1,2})?)/gi,
    // "Consultation Charges: 500"
    /(?:consultation\s*(?:charge[s]?|fee[s]?)[:\s]+)(?:rs\.?|inr|₹)?\s*(\d[\d,]*(?:\.\d{1,2})?)/gi,
    // "Bill Amount: 500" or "Billed: ₹500"
    /(?:bill(?:ed)?\s*(?:amount)?[:\s]+)(?:rs\.?|inr|₹)?\s*(\d[\d,]*(?:\.\d{1,2})?)/gi,
  ];

  for (const pattern of labeledPatterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(normalized);
    if (match) {
      const cleaned = match[1].replace(/,/g, "");
      const parsed = parseFloat(cleaned);
      if (!isNaN(parsed) && parsed > 0 && parsed < 1000000) {
        return parsed;
      }
    }
  }

  // Fallback: find any ₹/Rs./INR prefixed amounts
  const currencyPattern = /(?:rs\.?|inr|₹)\s*(\d[\d,]*(?:\.\d{1,2})?)/gi;
  const currencyMatches: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = currencyPattern.exec(normalized)) !== null) {
    const cleaned = match[1].replace(/,/g, "");
    const parsed = parseFloat(cleaned);
    if (!isNaN(parsed) && parsed > 0 && parsed < 1000000) {
      currencyMatches.push(parsed);
    }
  }

  if (currencyMatches.length > 0) {
    // Return the largest amount as it's most likely the total
    return Math.max(...currencyMatches);
  }

  return null;
}

/**
 * Internal action: process a single slip for amount extraction.
 */
export const extractAmountForSlip = internalAction({
  args: {
    slipId: v.id("opdSlips"),
    storageId: v.string(),
  },
  handler: async (ctx, args): Promise<{ slipId: string; amount: number | null; text: string }> => {
    try {
      const url = await ctx.storage.getUrl(args.storageId as Id<"_storage">);
      if (!url) {
        return { slipId: args.slipId, amount: null, text: "" };
      }

      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch slip: ${response.statusText}`);
      const buffer = await response.arrayBuffer();

      const text = await extractTextFromPdf(buffer);
      const amount = extractAmountFromText(text);

      // Persist extracted amount to the slip
      if (amount !== null) {
        await ctx.runMutation(internal.slips.setExtractedAmount, {
          slipId: args.slipId,
          amount,
        });
      }

      return { slipId: args.slipId, amount, text: text.slice(0, 500) };
    } catch (err) {
      // Don't throw — just return null amount so processing continues
      return { slipId: args.slipId, amount: null, text: "" };
    }
  },
});

/**
 * Public action: run smart amount matching on all slips of a file (or a group).
 * Called from the frontend after PDF splitting completes, or on-demand.
 */
export const runSmartAmountMatching = action({
  args: {
    fileId: v.optional(v.id("opdFiles")),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args): Promise<{ processed: number; matched: number; failed: number }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });

    // Get slips to process
    const slips = await ctx.runQuery(api.slips.listGroupSlips, {
      groupId: args.groupId,
      filter: "all",
    });

    // Filter by file if specified, and only process slips without an amount set
    const toProcess = slips.filter((s) => {
      const matchesFile = args.fileId ? s.fileId === args.fileId : true;
      const needsAmount = s.amount === undefined && s.amountOverride === undefined;
      return matchesFile && needsAmount;
    });

    let matched = 0;
    let failed = 0;

    // Process slips concurrently in batches of 5
    const BATCH_SIZE = 5;
    for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
      const batch = toProcess.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map((slip) =>
          ctx.runAction(internal.amountMatchingAction.extractAmountForSlip, {
            slipId: slip._id,
            storageId: slip.storageId,
          })
        )
      );
      for (const result of results) {
        if (result.amount !== null) matched++;
        else failed++;
      }
    }

    return { processed: toProcess.length, matched, failed };
  },
});
