import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";

// Best-effort error reporting from the client. Never throws — a failure to
// log an error shouldn't itself surface as a second error to the user.
export const logClientError = mutation({
  args: {
    groupId: v.optional(v.id("groups")),
    context: v.string(),
    message: v.string(),
    stack: v.optional(v.string()),
    slipIds: v.optional(v.array(v.id("opdSlips"))),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const user = identity
      ? await ctx.db
          .query("users")
          .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
          .unique()
      : null;

    await ctx.db.insert("clientErrorLogs", {
      userId: user?._id,
      groupId: args.groupId,
      context: args.context,
      message: args.message,
      stack: args.stack,
      slipIds: args.slipIds,
      userAgent: args.userAgent,
    });
  },
});

// Recent client-side error logs for a group — admin only.
export const listGroupErrorLogs = query({
  args: { groupId: v.id("groups"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new ConvexError({ message: "User not found", code: "NOT_FOUND" });

    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_and_user", (q) => q.eq("groupId", args.groupId).eq("userId", user._id))
      .unique();
    if (!membership || membership.role !== "admin") {
      throw new ConvexError({ message: "Only admins can view error logs", code: "FORBIDDEN" });
    }

    const logs = await ctx.db
      .query("clientErrorLogs")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .order("desc")
      .take(args.limit ?? 50);

    return Promise.all(
      logs.map(async (log) => {
        const reporter = log.userId ? await ctx.db.get(log.userId) : null;
        return { ...log, reporterName: reporter?.name ?? reporter?.email };
      })
    );
  },
});
