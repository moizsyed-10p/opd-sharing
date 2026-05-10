import { mutation, query, internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel.d.ts";

async function requireAuthUser(ctx: MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new ConvexError({ message: "User not found", code: "NOT_FOUND" });
  return user;
}

// List all available slips for a group (with URLs and claimer info)
export const listGroupSlips = query({
  args: {
    groupId: v.id("groups"),
    filter: v.optional(v.union(v.literal("all"), v.literal("available"), v.literal("claimed"))),
  },
  handler: async (ctx, args): Promise<Array<{
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
  }>> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return [];

    // Verify membership
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_and_user", (q) => q.eq("groupId", args.groupId).eq("userId", user._id))
      .unique();
    if (!membership) return [];

    const slips = await ctx.db
      .query("opdSlips")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .order("asc")
      .collect();

    const filtered = slips.filter((s) => {
      if (!args.filter || args.filter === "all") return true;
      if (args.filter === "available") return !s.isUsed;
      if (args.filter === "claimed") return s.isUsed;
      return true;
    });

    return Promise.all(
      filtered.map(async (s) => {
        const url = await ctx.storage.getUrl(s.storageId as Id<"_storage">);
        const file = await ctx.db.get(s.fileId);
        const claimer = s.usedBy ? await ctx.db.get(s.usedBy) : null;
        const effectiveAmount = s.amountOverride ?? s.amount;
        return {
          ...s,
          url,
          fileName: file?.originalName ?? "Unknown file",
          claimerName: claimer?.name,
          effectiveAmount,
        };
      })
    );
  },
});

// Atomic claim: check-then-insert in one mutation (Convex mutations are serialized = no races)
export const claimSlip = mutation({
  args: { slipId: v.id("opdSlips") },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);

    const slip = await ctx.db.get(args.slipId);
    if (!slip) throw new ConvexError({ message: "Slip not found", code: "NOT_FOUND" });

    // Verify membership
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_and_user", (q) => q.eq("groupId", slip.groupId).eq("userId", user._id))
      .unique();
    if (!membership) throw new ConvexError({ message: "Not a group member", code: "FORBIDDEN" });

    // Atomic check — already claimed?
    if (slip.isUsed) {
      throw new ConvexError({ message: "This slip has already been claimed", code: "CONFLICT" });
    }

    const now = new Date().toISOString();

    // Mark slip as used
    await ctx.db.patch(args.slipId, {
      isUsed: true,
      usedBy: user._id,
      usedAt: now,
    });

    // Write usage ledger
    await ctx.db.insert("userOpdUsage", {
      userId: user._id,
      slipId: args.slipId,
      groupId: slip.groupId,
      claimedAt: now,
    });

    // Return a fresh signed URL for immediate download
    const url = await ctx.storage.getUrl(slip.storageId as Id<"_storage">);
    return { url };
  },
});

// Unclaim a slip (admin only)
export const unclaimSlip = mutation({
  args: { slipId: v.id("opdSlips") },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const slip = await ctx.db.get(args.slipId);
    if (!slip) throw new ConvexError({ message: "Slip not found", code: "NOT_FOUND" });

    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_and_user", (q) => q.eq("groupId", slip.groupId).eq("userId", user._id))
      .unique();
    if (!membership || membership.role !== "admin") {
      throw new ConvexError({ message: "Only admins can unclaim slips", code: "FORBIDDEN" });
    }

    await ctx.db.patch(args.slipId, { isUsed: false, usedBy: undefined, usedAt: undefined });

    // Remove usage records
    const usages = await ctx.db
      .query("userOpdUsage")
      .withIndex("by_slip", (q) => q.eq("slipId", args.slipId))
      .collect();
    for (const u of usages) await ctx.db.delete(u._id);
  },
});

// Update amount override on a slip
export const updateSlipAmount = mutation({
  args: { slipId: v.id("opdSlips"), amount: v.union(v.number(), v.null()) },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const slip = await ctx.db.get(args.slipId);
    if (!slip) throw new ConvexError({ message: "Slip not found", code: "NOT_FOUND" });

    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_and_user", (q) => q.eq("groupId", slip.groupId).eq("userId", user._id))
      .unique();
    if (!membership) throw new ConvexError({ message: "Not a group member", code: "FORBIDDEN" });

    await ctx.db.patch(args.slipId, {
      amountOverride: args.amount === null ? undefined : args.amount,
    });
  },
});

// Internal mutation: set extracted amount on a slip (no auth check, called from actions)
export const setExtractedAmount = internalMutation({
  args: { slipId: v.id("opdSlips"), amount: v.number() },
  handler: async (ctx, args) => {
    const slip = await ctx.db.get(args.slipId);
    if (!slip) return;
    // Only set if not already overridden by user
    if (slip.amountOverride === undefined) {
      await ctx.db.patch(args.slipId, { amount: args.amount });
    }
  },
});
export const myClaimedSlips = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args): Promise<Array<{
    _id: Id<"opdSlips">;
    pageNumber: number;
    fileName: string;
    usedAt: string | undefined;
    effectiveAmount: number | undefined;
    url: string | null;
  }>> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return [];

    const usages = await ctx.db
      .query("userOpdUsage")
      .withIndex("by_group_and_user", (q) => q.eq("groupId", args.groupId).eq("userId", user._id))
      .collect();

    return Promise.all(
      usages.map(async (u) => {
        const slip = await ctx.db.get(u.slipId);
        if (!slip) return null;
        const file = await ctx.db.get(slip.fileId);
        const url = await ctx.storage.getUrl(slip.storageId as Id<"_storage">);
        return {
          _id: slip._id,
          pageNumber: slip.pageNumber,
          fileName: file?.originalName ?? "Unknown",
          usedAt: u.claimedAt,
          effectiveAmount: slip.amountOverride ?? slip.amount,
          url,
        };
      })
    ).then((r) => r.filter(Boolean) as Array<{
      _id: Id<"opdSlips">;
      pageNumber: number;
      fileName: string;
      usedAt: string | undefined;
      effectiveAmount: number | undefined;
      url: string | null;
    }>);
  },
});
