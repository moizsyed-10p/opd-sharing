import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel.d.ts";

export function effectivePermission(
  m: Pick<Doc<"groupMembers">, "permission">
): "upload_only" | "claim_and_upload" {
  return m.permission ?? "claim_and_upload";
}

// Members who can actually claim slips — "fully used" should only require
// claims from these members, not from upload_only members who can never claim.
export async function getClaimEligibleMemberCount(
  ctx: MutationCtx | QueryCtx,
  groupId: Id<"groups">
): Promise<number> {
  const members = await ctx.db
    .query("groupMembers")
    .withIndex("by_group", (q) => q.eq("groupId", groupId))
    .collect();
  return members.filter((m) => effectivePermission(m) !== "upload_only").length;
}

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function getAuthenticatedUser(ctx: MutationCtx | QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new ConvexError({ message: "User not found", code: "NOT_FOUND" });
  return user;
}

export const createGroup = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const inviteCode = generateInviteCode();
    const groupId = await ctx.db.insert("groups", {
      name: args.name,
      description: args.description,
      inviteCode,
      createdBy: user._id,
    });
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: user._id,
      role: "admin",
    });
    return groupId;
  },
});

export const joinGroup = mutation({
  args: { inviteCode: v.string() },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const group = await ctx.db
      .query("groups")
      .withIndex("by_invite_code", (q) => q.eq("inviteCode", args.inviteCode.toUpperCase()))
      .unique();
    if (!group) throw new ConvexError({ message: "Invalid invite code", code: "NOT_FOUND" });

    const existing = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_and_user", (q) =>
        q.eq("groupId", group._id).eq("userId", user._id)
      )
      .unique();
    if (existing) throw new ConvexError({ message: "Already a member", code: "CONFLICT" });

    await ctx.db.insert("groupMembers", {
      groupId: group._id,
      userId: user._id,
      role: "member",
    });
    return group._id;
  },
});

export const listMyGroups = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return [];

    const memberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const groups = await Promise.all(
      memberships.map(async (m) => {
        const group = await ctx.db.get(m.groupId);
        if (!group) return null;
        const memberCount = await ctx.db
          .query("groupMembers")
          .withIndex("by_group", (q) => q.eq("groupId", m.groupId))
          .collect();
        return { ...group, role: m.role, memberCount: memberCount.length };
      })
    );
    return groups.filter(Boolean);
  },
});

export const getGroup = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
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

    const group = await ctx.db.get(args.groupId);
    return group
      ? { ...group, role: membership.role, permission: effectivePermission(membership) }
      : null;
  },
});

export const getGroupMembers = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return [];

    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_and_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", user._id)
      )
      .unique();
    if (!membership) return [];

    const members = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();

    return Promise.all(
      members.map(async (m) => {
        const memberUser = await ctx.db.get(m.userId);
        return { ...m, permission: effectivePermission(m), user: memberUser };
      })
    );
  },
});

export const leaveGroup = mutation({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_and_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", user._id)
      )
      .unique();
    if (!membership) throw new ConvexError({ message: "Not a member", code: "NOT_FOUND" });
    await ctx.db.delete(membership._id);
  },
});

async function requireAdminMembership(
  ctx: MutationCtx,
  groupId: import("./_generated/dataModel.d.ts").Id<"groups">
) {
  const user = await getAuthenticatedUser(ctx);
  const membership = await ctx.db
    .query("groupMembers")
    .withIndex("by_group_and_user", (q) => q.eq("groupId", groupId).eq("userId", user._id))
    .unique();
  if (!membership || membership.role !== "admin") {
    throw new ConvexError({ message: "Only admins can do this", code: "FORBIDDEN" });
  }
  return { user, membership };
}

export const updateMemberPermission = mutation({
  args: {
    groupId: v.id("groups"),
    userId: v.id("users"),
    permission: v.union(v.literal("upload_only"), v.literal("claim_and_upload")),
  },
  handler: async (ctx, args) => {
    await requireAdminMembership(ctx, args.groupId);
    const target = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_and_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", args.userId)
      )
      .unique();
    if (!target) throw new ConvexError({ message: "Member not found", code: "NOT_FOUND" });
    await ctx.db.patch(target._id, { permission: args.permission });
  },
});

export const removeMember = mutation({
  args: { groupId: v.id("groups"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const { user } = await requireAdminMembership(ctx, args.groupId);
    if (args.userId === user._id) {
      throw new ConvexError({ message: "Use 'Leave group' to remove yourself", code: "BAD_REQUEST" });
    }

    const target = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_and_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", args.userId)
      )
      .unique();
    if (!target) throw new ConvexError({ message: "Member not found", code: "NOT_FOUND" });

    if (target.role === "admin") {
      const allMembers = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
        .collect();
      const adminCount = allMembers.filter((m) => m.role === "admin").length;
      if (adminCount <= 1) {
        throw new ConvexError({
          message: "Group must have at least one admin",
          code: "BAD_REQUEST",
        });
      }
    }

    // Intentionally leave userOpdUsage and opdFiles.uploadedBy untouched —
    // claim/upload history is preserved after a member is removed.
    await ctx.db.delete(target._id);
  },
});
