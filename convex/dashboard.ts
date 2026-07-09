import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel.d.ts";

export const groupDashboard = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args): Promise<{
    totalSlips: number;
    availableSlips: number;  // slips not yet claimed by current user
    claimedSlips: number;    // slips claimed by current user
    fullyUsedSlips: number;  // slips claimed by ALL members
    totalPoolValue: number;  // value of slips available to current user
    claimedValue: number;    // value of slips current user claimed
    availableValue: number;  // value still available for current user
    memberStats: Array<{
      userId: Id<"users">;
      name: string;
      email: string | undefined;
      avatarUrl: string | undefined;
      role: "admin" | "member";
      claimedCount: number;
      claimedValue: number;
    }>;
    uploadStats: Array<{
      userId: Id<"users">;
      name: string;
      email: string | undefined;
      avatarUrl: string | undefined;
      role: "admin" | "member";
      fileCount: number;
      slipCount: number;
      uploadedValue: number;
    }>;
    recentActivity: Array<{
      slipId: Id<"opdSlips">;
      userName: string;
      fileName: string;
      pageNumber: number;
      effectiveAmount: number | undefined;
      claimedAt: string;
    }>;
    slipsByFile: Array<{
      fileId: Id<"opdFiles">;
      fileName: string;
      total: number;
      claimedByMe: number;
      fullyUsed: number;
      available: number;
    }>;
  } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return null;

    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_and_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", user._id)
      )
      .unique();
    if (!membership) return null;

    // Fetch all slips and members
    const slips = await ctx.db
      .query("opdSlips")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();

    const allMembers = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    const memberCount = allMembers.length;

    // Fetch all usages for this group
    const allUsages = await ctx.db
      .query("userOpdUsage")
      .withIndex("by_group_and_user", (q) => q.eq("groupId", args.groupId))
      .collect();

    // Build sets for fast lookup
    const myClaimedSlipIds = new Set(
      allUsages.filter((u) => u.userId === user._id).map((u) => u.slipId)
    );

    // Build claim count per slip
    const claimCountMap = new Map<string, number>();
    for (const u of allUsages) {
      claimCountMap.set(u.slipId, (claimCountMap.get(u.slipId) ?? 0) + 1);
    }

    const totalSlips = slips.length;

    // From current user's perspective
    const claimedSlips = slips.filter((s) => myClaimedSlipIds.has(s._id)).length;
    const availableSlips = totalSlips - claimedSlips;
    const fullyUsedSlips = slips.filter((s) =>
      (claimCountMap.get(s._id) ?? 0) >= memberCount
    ).length;

    // Pool values from current user's perspective
    const totalPoolValue = slips
      .filter((s) => !myClaimedSlipIds.has(s._id))
      .reduce((sum, s) => sum + (s.amountOverride ?? s.amount ?? 0), 0);

    const claimedValue = slips
      .filter((s) => myClaimedSlipIds.has(s._id))
      .reduce((sum, s) => sum + (s.amountOverride ?? s.amount ?? 0), 0);

    const availableValue = totalPoolValue;

    // Per-member stats (admin view — how many each person claimed)
    const memberStats = await Promise.all(
      allMembers.map(async (m) => {
        const memberUser = await ctx.db.get(m.userId);
        const usages = allUsages.filter((u) => u.userId === m.userId);

        let memberClaimedValue = 0;
        for (const u of usages) {
          const slip = await ctx.db.get(u.slipId);
          memberClaimedValue += slip?.amountOverride ?? slip?.amount ?? 0;
        }

        return {
          userId: m.userId,
          name: memberUser?.name ?? memberUser?.email?.split("@")[0] ?? "Member",
          email: memberUser?.email,
          avatarUrl: memberUser?.avatarUrl,
          role: m.role,
          claimedCount: usages.length,
          claimedValue: memberClaimedValue,
        };
      })
    );

    // Per-member upload stats (how much each person uploaded to the pool)
    const files = await ctx.db
      .query("opdFiles")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();

    const uploadStats = await Promise.all(
      allMembers.map(async (m) => {
        const memberUser = await ctx.db.get(m.userId);
        const memberFiles = files.filter((f) => f.uploadedBy === m.userId);
        const memberFileIds = new Set(memberFiles.map((f) => f._id));
        const memberSlips = slips.filter((s) => memberFileIds.has(s.fileId));
        const uploadedValue = memberSlips.reduce(
          (sum, s) => sum + (s.amountOverride ?? s.amount ?? 0),
          0
        );

        return {
          userId: m.userId,
          name: memberUser?.name ?? memberUser?.email?.split("@")[0] ?? "Member",
          email: memberUser?.email,
          avatarUrl: memberUser?.avatarUrl,
          role: m.role,
          fileCount: memberFiles.length,
          slipCount: memberSlips.length,
          uploadedValue,
        };
      })
    );

    // Recent activity
    const sorted = [...allUsages].sort(
      (a, b) => new Date(b.claimedAt).getTime() - new Date(a.claimedAt).getTime()
    );

    const recentActivity = (
      await Promise.all(
        sorted.slice(0, 20).map(async (u) => {
          const actUser = await ctx.db.get(u.userId);
          const slip = await ctx.db.get(u.slipId);
          if (!slip) return null;
          const file = await ctx.db.get(slip.fileId);
          return {
            slipId: u.slipId,
            userName: actUser?.name ?? actUser?.email?.split("@")[0] ?? "Member",
            fileName: file?.originalName ?? "file",
            pageNumber: slip.pageNumber,
            effectiveAmount: slip.amountOverride ?? slip.amount,
            claimedAt: u.claimedAt,
          };
        })
      )
    ).filter(Boolean) as Array<{
      slipId: Id<"opdSlips">;
      userName: string;
      fileName: string;
      pageNumber: number;
      effectiveAmount: number | undefined;
      claimedAt: string;
    }>;

    // Slips breakdown by file — per user perspective
    const slipsByFile = files.map((f) => {
      const fileSlips = slips.filter((s) => s.fileId === f._id);
      const claimedByMe = fileSlips.filter((s) => myClaimedSlipIds.has(s._id)).length;
      const fullyUsed = fileSlips.filter((s) =>
        (claimCountMap.get(s._id) ?? 0) >= memberCount
      ).length;
      return {
        fileId: f._id,
        fileName: f.originalName,
        total: fileSlips.length,
        claimedByMe,
        fullyUsed,
        available: fileSlips.length - claimedByMe,
      };
    }).filter((f) => f.total > 0);

    return {
      totalSlips,
      availableSlips,
      claimedSlips,
      fullyUsedSlips,
      totalPoolValue,
      claimedValue,
      availableValue,
      memberStats,
      uploadStats,
      recentActivity,
      slipsByFile,
    };
  },
});

// Detailed claim/upload history for a single member, grouped-ready (raw timestamps included)
export const memberDetail = query({
  args: { groupId: v.id("groups"), userId: v.id("users") },
  handler: async (ctx, args): Promise<{
    claims: Array<{
      slipId: Id<"opdSlips">;
      fileName: string;
      pageNumber: number;
      effectiveAmount: number | undefined;
      claimedAt: string;
    }>;
    uploads: Array<{
      fileId: Id<"opdFiles">;
      fileName: string;
      createdAt: number;
      slipCount: number;
      uploadedValue: number;
    }>;
  } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return null;
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_and_user", (q) => q.eq("groupId", args.groupId).eq("userId", user._id))
      .unique();
    if (!membership) return null;

    const usages = await ctx.db
      .query("userOpdUsage")
      .withIndex("by_group_and_user", (q) => q.eq("groupId", args.groupId).eq("userId", args.userId))
      .collect();

    const claims = (
      await Promise.all(
        usages.map(async (u) => {
          const slip = await ctx.db.get(u.slipId);
          if (!slip) return null;
          const file = await ctx.db.get(slip.fileId);
          return {
            slipId: u.slipId,
            fileName: file?.originalName ?? "Unknown file",
            pageNumber: slip.pageNumber,
            effectiveAmount: slip.amountOverride ?? slip.amount,
            claimedAt: u.claimedAt,
          };
        })
      )
    ).filter(Boolean) as Array<{
      slipId: Id<"opdSlips">;
      fileName: string;
      pageNumber: number;
      effectiveAmount: number | undefined;
      claimedAt: string;
    }>;

    const files = await ctx.db
      .query("opdFiles")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    const memberFiles = files.filter((f) => f.uploadedBy === args.userId);

    const uploads = await Promise.all(
      memberFiles.map(async (f) => {
        const slips = await ctx.db
          .query("opdSlips")
          .withIndex("by_file", (q) => q.eq("fileId", f._id))
          .collect();
        const uploadedValue = slips.reduce(
          (sum, s) => sum + (s.amountOverride ?? s.amount ?? 0),
          0
        );
        return {
          fileId: f._id,
          fileName: f.originalName,
          createdAt: f._creationTime,
          slipCount: slips.length,
          uploadedValue,
        };
      })
    );

    return { claims, uploads };
  },
});