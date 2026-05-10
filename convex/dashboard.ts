import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel.d.ts";

export const groupDashboard = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args): Promise<{
    totalSlips: number;
    availableSlips: number;
    claimedSlips: number;
    totalPoolValue: number;
    claimedValue: number;
    availableValue: number;
    memberStats: Array<{
      userId: Id<"users">;
      name: string;
      email: string | undefined;
      avatarUrl: string | undefined;
      role: "admin" | "member";
      claimedCount: number;
      claimedValue: number;
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
      claimed: number;
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

    // Fetch all slips in this group
    const slips = await ctx.db
      .query("opdSlips")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();

    const totalSlips = slips.length;
    const claimedSlips = slips.filter((s) => s.isUsed).length;
    const availableSlips = totalSlips - claimedSlips;

    const totalPoolValue = slips.reduce((sum, s) => sum + (s.amountOverride ?? s.amount ?? 0), 0);
    const claimedValue = slips
      .filter((s) => s.isUsed)
      .reduce((sum, s) => sum + (s.amountOverride ?? s.amount ?? 0), 0);
    const availableValue = totalPoolValue - claimedValue;

    // Per-member stats
    const members = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();

    const memberStats = await Promise.all(
      members.map(async (m) => {
        const memberUser = await ctx.db.get(m.userId);
        const usages = await ctx.db
          .query("userOpdUsage")
          .withIndex("by_group_and_user", (q) =>
            q.eq("groupId", args.groupId).eq("userId", m.userId)
          )
          .collect();

        let claimedValue = 0;
        for (const u of usages) {
          const slip = await ctx.db.get(u.slipId);
          claimedValue += slip?.amountOverride ?? slip?.amount ?? 0;
        }

        return {
          userId: m.userId,
          name: memberUser?.name ?? "Unknown",
          email: memberUser?.email,
          avatarUrl: memberUser?.avatarUrl,
          role: m.role,
          claimedCount: usages.length,
          claimedValue,
        };
      })
    );

    // Recent activity (last 20 claims across all members)
    const allUsages = await ctx.db
      .query("userOpdUsage")
      .withIndex("by_group_and_user", (q) => q.eq("groupId", args.groupId))
      .collect();

    // Sort by claimedAt descending
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
            userName: actUser?.name ?? "Unknown",
            fileName: file?.originalName ?? "Unknown",
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

    // Slips breakdown by file
    const files = await ctx.db
      .query("opdFiles")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();

    const slipsByFile = files.map((f) => {
      const fileSlips = slips.filter((s) => s.fileId === f._id);
      const claimed = fileSlips.filter((s) => s.isUsed).length;
      return {
        fileId: f._id,
        fileName: f.originalName,
        total: fileSlips.length,
        claimed,
        available: fileSlips.length - claimed,
      };
    }).filter((f) => f.total > 0);

    return {
      totalSlips,
      availableSlips,
      claimedSlips,
      totalPoolValue,
      claimedValue,
      availableValue,
      memberStats,
      recentActivity,
      slipsByFile,
    };
  },
});
