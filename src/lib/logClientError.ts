import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { ConvexError } from "convex/values";
import { convex } from "@/components/providers/auth.tsx";

type LogClientErrorArgs = {
  context: string;
  error: unknown;
  groupId?: Id<"groups">;
  slipIds?: Id<"opdSlips">[];
};

/** Reports a client-side error to Convex so it survives past the console. Never throws. */
export async function logClientError({ context, error, groupId, slipIds }: LogClientErrorArgs) {
  const message = error instanceof ConvexError
    ? (error.data as { message?: string })?.message ?? JSON.stringify(error.data)
    : error instanceof Error
      ? error.message
      : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  console.error(`[${context}]`, error);

  try {
    await convex.mutation(api.clientLogs.logClientError, {
      context,
      message,
      stack,
      groupId,
      slipIds,
      userAgent: navigator.userAgent,
    });
  } catch (loggingError) {
    console.error("Failed to report client error", loggingError);
  }
}
