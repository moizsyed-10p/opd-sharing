import { mutation, query, internalMutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
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

async function getAuthUser(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

// List slips from current user's perspective
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
    isUsed: boolean;        // global: true if ALL members claimed
    isClaimedByMe: boolean; // per-user claim status
    usedBy?: Id<"users">;
    usedAt?: string;
    url: string | null;
    fileName: string;
    claimerName: string | undefined;
    effectiveAmount: number | undefined;
    claimedByCount: number; // how many members have claimed this slip
  }>> => {
    const user = await getAuthUser(ctx);
    if (!user) return [];

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

    // Get all usage records for this group in one query
    const allUsages = await ctx.db
      .query("userOpdUsage")
      .withIndex("by_group_and_user", (q) => q.eq("groupId", args.groupId))
      .collect();

    // Get total member count for this group
    const allMembers = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    const memberCount = allMembers.length;

    // Build a set of slipIds claimed by current user
    const myClaimedSlipIds = new Set(
      allUsages.filter((u) => u.userId === user._id).map((u) => u.slipId)
    );

    // Build a map of slipId -> claim count
    const claimCountMap = new Map<string, number>();
    for (const u of allUsages) {
      claimCountMap.set(u.slipId, (claimCountMap.get(u.slipId) ?? 0) + 1);
    }

    const results = await Promise.all(
      slips.map(async (s) => {
        const isClaimedByMe = myClaimedSlipIds.has(s._id);
        const claimedByCount = claimCountMap.get(s._id) ?? 0;
        const isFullyUsed = claimedByCount >= memberCount;

        const url = await ctx.storage.getUrl(s.storageId as Id<"_storage">);
        const file = await ctx.db.get(s.fileId);
        const claimer = s.usedBy ? await ctx.db.get(s.usedBy) : null;
        const effectiveAmount = s.amountOverride ?? s.amount;

        return {
          ...s,
          isUsed: isFullyUsed,       // true only when ALL members claimed
          isClaimedByMe,             // true if current user claimed it
          claimedByCount,
          url,
          fileName: file?.originalName ?? "Unknown file",
          claimerName: claimer?.name,
          effectiveAmount,
        };
      })
    );

    // Filter based on current user's perspective
    return results.filter((s) => {
      if (!args.filter || args.filter === "all") return true;
      if (args.filter === "available") return !s.isClaimedByMe; // not yet claimed by ME
      if (args.filter === "claimed") return s.isClaimedByMe;    // claimed by ME
      return true;
    });
  },
});

// Claim a slip for the current user
export const claimSlip = mutation({
  args: { slipId: v.id("opdSlips") },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);

    const slip = await ctx.db.get(args.slipId);
    if (!slip) throw new ConvexError({ message: "Slip not found", code: "NOT_FOUND" });

    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_and_user", (q) => q.eq("groupId", slip.groupId).eq("userId", user._id))
      .unique();
    if (!membership) throw new ConvexError({ message: "Not a group member", code: "FORBIDDEN" });

    // Check if current user already claimed this slip
    const existingUsage = await ctx.db
      .query("userOpdUsage")
      .withIndex("by_slip_and_user", (q) => q.eq("slipId", args.slipId).eq("userId", user._id))
      .unique();

    if (existingUsage) {
      throw new ConvexError({ message: "You have already claimed this slip", code: "CONFLICT" });
    }

    const now = new Date().toISOString();

    // Write usage record for this user
    await ctx.db.insert("userOpdUsage", {
      userId: user._id,
      slipId: args.slipId,
      groupId: slip.groupId,
      claimedAt: now,
    });

    // Check if all members have now claimed this slip
    const allMembers = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", slip.groupId))
      .collect();

    const allUsages = await ctx.db
      .query("userOpdUsage")
      .withIndex("by_slip", (q) => q.eq("slipId", args.slipId))
      .collect();

    if (allUsages.length >= allMembers.length) {
      // All members claimed — mark as globally used
      await ctx.db.patch(args.slipId, {
        isUsed: true,
        usedBy: user._id,
        usedAt: now,
      });
    }

    const url = await ctx.storage.getUrl(slip.storageId as Id<"_storage">);
    return { url };
  },
});

// Unclaim a slip for a specific user (admin only)
export const unclaimSlip = mutation({
  args: {
    slipId: v.id("opdSlips"),
    targetUserId: v.optional(v.id("users")), // if not provided, unclaims for current user
  },
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

    const targetId = args.targetUserId ?? user._id;

    // Remove usage record for target user
    const usage = await ctx.db
      .query("userOpdUsage")
      .withIndex("by_slip_and_user", (q) => q.eq("slipId", args.slipId).eq("userId", targetId))
      .unique();
    if (usage) await ctx.db.delete(usage._id);

    // Unmark global isUsed since not all members have claimed anymore
    await ctx.db.patch(args.slipId, {
      isUsed: false,
      usedBy: undefined,
      usedAt: undefined,
    });
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

// Internal mutation: set extracted amount
export const setExtractedAmount = internalMutation({
  args: { slipId: v.id("opdSlips"), amount: v.number() },
  handler: async (ctx, args) => {
    const slip = await ctx.db.get(args.slipId);
    if (!slip) return;
    if (slip.amountOverride === undefined) {
      await ctx.db.patch(args.slipId, { amount: args.amount });
    }
  },
});

// My claimed slips
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
    const user = await getAuthUser(ctx);
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

// Save extracted amounts from client-side OCR
export const saveExtractedAmounts = mutation({
  args: {
    amounts: v.array(v.object({
      slipId: v.id("opdSlips"),
      amount: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });

    for (const { slipId, amount } of args.amounts) {
      const slip = await ctx.db.get(slipId);
      if (!slip) continue;
      if (slip.amountOverride === undefined && slip.amount === undefined) {
        await ctx.db.patch(slipId, { amount });
      }
    }
  },
});