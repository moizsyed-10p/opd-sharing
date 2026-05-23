"use node";

import { action, internalAction } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.d.ts";

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

export const extractAmountFromImage = action({
  args: {
    storageId: v.string(),
  },
  handler: async (ctx, args): Promise<number | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const url = await ctx.storage.getUrl(args.storageId as Id<"_storage">);
    if (!url) return null;

    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    const apiKey = process.env.GOOGLE_VISION_API_KEY;
    if (!apiKey) return null;

    // Send as PDF document instead of IMAGE — Vision supports PDFs via document text detection
    const visionResponse = await fetch(
      `https://vision.googleapis.com/v1/files:annotate?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [
            {
              inputConfig: {
                content: base64,
                mimeType: "application/pdf",
              },
              features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
              pages: [1], // only first page of each slip PDF
            },
          ],
        }),
      }
    );

    if (!visionResponse.ok) {
      console.log("Vision error:", await visionResponse.text());
      return null;
    }

    const data = await visionResponse.json() as {
      responses: Array<{
        responses?: Array<{
          fullTextAnnotation?: { text: string };
        }>;
      }>;
    };

    const text = data.responses[0]?.responses?.[0]?.fullTextAnnotation?.text ?? "";
    return extractAmountFromText(text);
  },
});

// Keep the regex-based extraction as fallback for text-based PDFs
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
    /(?:amount\s*in\s*words)[:\s\w]+rupees[:\s]+(?:rs\.?|pkr|inr|₹)?\s*(\d[\d,]*(?:\.\d{1,2})?)/gi,
    /(?:rate|amount)\s+(\d[\d,]*(?:\.\d{1,2})?)(?:\s*$)/gim,
    
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
 
  // Fallback: largest Rs./PKR prefixed amount
  const fallbackPattern = /(?:rs\.?|pkr|inr|₹)\s*(\d[\d,]*(?:\.\d{1,2})?)/gi;
  const fallback: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = fallbackPattern.exec(normalized)) !== null) {
    const parsed = parseFloat(match[1].replace(/,/g, ""));
    if (!isNaN(parsed) && parsed > 0 && parsed < 1000000) fallback.push(parsed);
  }
  if (fallback.length > 0) return Math.max(...fallback);

  // Fallback: amount in words (e.g. "EIGHT HUNDRED RUPEES ONLY")
  const wordsMatch = normalized.match(/amount\s+in\s+words[:\s]+([a-z\s]+)rupees/i);
  if (wordsMatch) {
    const fromWords = wordsToNumber(wordsMatch[1]);
    if (fromWords) return fromWords;
  }

  return null;
  // return fallback.length > 0 ? Math.max(...fallback) : null;
}

export const extractAmountForSlip = internalAction({
  args: {
    slipId: v.id("opdSlips"),
    storageId: v.string(),
  },
  handler: async (ctx, args): Promise<{ slipId: string; amount: number | null }> => {
    try {
      const url = await ctx.storage.getUrl(args.storageId as Id<"_storage">);
      if (!url) return { slipId: args.slipId, amount: null };

      const response = await fetch(url);
      if (!response.ok) return { slipId: args.slipId, amount: null };

      // Only try text extraction — no pdfjs, no OCR on server
      // OCR is now handled client-side in PdfUploader
      const text = await response.text().catch(() => "");
      const amount = extractAmountFromText(text);

      if (amount !== null) {
        await ctx.runMutation(internal.slips.setExtractedAmount, {
          slipId: args.slipId,
          amount,
        });
      }

      return { slipId: args.slipId, amount };
    } catch {
      return { slipId: args.slipId, amount: null };
    }
  },
});

export const runSmartAmountMatching = action({
  args: {
    fileId: v.optional(v.id("opdFiles")),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args): Promise<{ processed: number; matched: number; failed: number }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });

    const slips = await ctx.runQuery(api.slips.listGroupSlips, {
      groupId: args.groupId,
      filter: "all",
    });

    const toProcess = slips.filter((s) => {
      const matchesFile = args.fileId ? s.fileId === args.fileId : true;
      const needsAmount = s.amount === undefined && s.amountOverride === undefined;
      return matchesFile && needsAmount;
    });

    let matched = 0;
    let failed = 0;

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