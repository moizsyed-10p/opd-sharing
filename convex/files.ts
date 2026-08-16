import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel.d.ts";

async function requireGroupMember(ctx: MutationCtx | QueryCtx, groupId: Id<"groups">) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new ConvexError({ message: "User not found", code: "NOT_FOUND" });
  const membership = await ctx.db
    .query("groupMembers")
    .withIndex("by_group_and_user", (q) => q.eq("groupId", groupId).eq("userId", user._id))
    .unique();
  if (!membership) throw new ConvexError({ message: "Not a group member", code: "FORBIDDEN" });
  return { user, membership };
}

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });
    return await ctx.storage.generateUploadUrl();
  },
});

export const saveOpdFile = mutation({
  args: {
    groupId: v.id("groups"),
    storageId: v.id("_storage"),
    originalName: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireGroupMember(ctx, args.groupId);
    const fileId = await ctx.db.insert("opdFiles", {
      groupId: args.groupId,
      uploadedBy: user._id,
      originalName: args.originalName,
      storageId: args.storageId,
      pageCount: 0,
      status: "pending",
    });
    return fileId;
  },
});

export const updateFileStatus = mutation({
  args: {
    fileId: v.id("opdFiles"),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("done"),
      v.literal("error")
    ),
    pageCount: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = { status: args.status };
    if (args.pageCount !== undefined) patch.pageCount = args.pageCount;
    await ctx.db.patch(args.fileId, patch);
  },
});

export const saveSlip = mutation({
  args: {
    groupId: v.id("groups"),
    fileId: v.id("opdFiles"),
    pageNumber: v.number(),
    storageId: v.id("_storage"),
    amount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("opdSlips", {
      groupId: args.groupId,
      fileId: args.fileId,
      pageNumber: args.pageNumber,
      storageId: args.storageId,
      amount: args.amount,
      isUsed: false,
    });
  },
});

export const listOpdFiles = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args): Promise<Array<{
    _id: Id<"opdFiles">;
    _creationTime: number;
    groupId: Id<"groups">;
    uploadedBy: Id<"users">;
    originalName: string;
    storageId: string;
    pageCount: number;
    status: "pending" | "processing" | "done" | "error";
    uploaderName?: string;
    slipCount: number;
    usedCount: number;
  }>> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return [];
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_and_user", (q) => q.eq("groupId", args.groupId).eq("userId", user._id))
      .unique();
    if (!membership) return [];

    const files = await ctx.db
      .query("opdFiles")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .order("desc")
      .collect();

    return Promise.all(
      files.map(async (f) => {
        const uploader = await ctx.db.get(f.uploadedBy);
        const slips = await ctx.db
          .query("opdSlips")
          .withIndex("by_file", (q) => q.eq("fileId", f._id))
          .collect();
        const usedCount = slips.filter((s) => s.isUsed).length;
        return {
          ...f,
          uploaderName: uploader?.name,
          slipCount: slips.length,
          usedCount,
        };
      })
    );
  },
});

export const getSlipsForFile = query({
  args: { fileId: v.id("opdFiles") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const slips = await ctx.db
      .query("opdSlips")
      .withIndex("by_file", (q) => q.eq("fileId", args.fileId))
      .order("asc")
      .collect();
    return Promise.all(
      slips.map(async (s) => {
        const url = await ctx.storage.getUrl(s.storageId as Id<"_storage">);
        return { ...s, url };
      })
    );
  },
});

export const deleteOpdFile = mutation({
  args: { fileId: v.id("opdFiles") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new ConvexError({ message: "User not found", code: "NOT_FOUND" });

    const file = await ctx.db.get(args.fileId);
    if (!file) throw new ConvexError({ message: "File not found", code: "NOT_FOUND" });

    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_and_user", (q) => q.eq("groupId", file.groupId).eq("userId", user._id))
      .unique();
    if (!membership || membership.role !== "admin") {
      throw new ConvexError({ message: "Only admins can delete files", code: "FORBIDDEN" });
    }

    // Delete all slips for this file
    const slips = await ctx.db
      .query("opdSlips")
      .withIndex("by_file", (q) => q.eq("fileId", args.fileId))
      .collect();
    for (const slip of slips) {
      await ctx.storage.delete(slip.storageId as Id<"_storage">);
      // Remove usage records
      const usages = await ctx.db
        .query("userOpdUsage")
        .withIndex("by_slip", (q) => q.eq("slipId", slip._id))
        .collect();
      for (const u of usages) await ctx.db.delete(u._id);
      await ctx.db.delete(slip._id);
    }
    // Delete original file from storage
    await ctx.storage.delete(file.storageId as Id<"_storage">);
    await ctx.db.delete(args.fileId);
  },
});

async function requireAdmin(ctx: MutationCtx | QueryCtx, groupId: Id<"groups">) {
  const { user, membership } = await requireGroupMember(ctx, groupId);
  if (membership.role !== "admin") {
    throw new ConvexError({ message: "Only admins can do this", code: "FORBIDDEN" });
  }
  return user;
}

async function groupFullyUsedByFile(ctx: MutationCtx | QueryCtx, groupId: Id<"groups">) {
  const usedSlips = await ctx.db
    .query("opdSlips")
    .withIndex("by_group_and_used", (q) => q.eq("groupId", groupId).eq("isUsed", true))
    .collect();

  const byFile = new Map<Id<"opdFiles">, typeof usedSlips>();
  for (const slip of usedSlips) {
    const arr = byFile.get(slip.fileId) ?? [];
    arr.push(slip);
    byFile.set(slip.fileId, arr);
  }

  const fullyDeletableFiles: Id<"opdFiles">[] = [];
  for (const [fileId, slips] of byFile) {
    const allSlipsForFile = await ctx.db
      .query("opdSlips")
      .withIndex("by_file", (q) => q.eq("fileId", fileId))
      .collect();
    if (allSlipsForFile.every((s) => s.isUsed)) {
      fullyDeletableFiles.push(fileId);
    }
    void slips;
  }

  return { usedSlips, fullyDeletableFiles };
}

export const previewBulkCleanup = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.groupId);
    const { usedSlips, fullyDeletableFiles } = await groupFullyUsedByFile(ctx, args.groupId);
    return {
      slipsToDelete: usedSlips.length,
      filesToDelete: fullyDeletableFiles.length,
    };
  },
});

export const bulkDeleteUsedSlips = mutation({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.groupId);
    const { usedSlips } = await groupFullyUsedByFile(ctx, args.groupId);

    const affectedFileIds = new Set(usedSlips.map((s) => s.fileId));

    for (const slip of usedSlips) {
      await ctx.storage.delete(slip.storageId as Id<"_storage">);
      const usages = await ctx.db
        .query("userOpdUsage")
        .withIndex("by_slip", (q) => q.eq("slipId", slip._id))
        .collect();
      for (const u of usages) await ctx.db.delete(u._id);
      await ctx.db.delete(slip._id);
    }

    let deletedFiles = 0;
    for (const fileId of affectedFileIds) {
      const remaining = await ctx.db
        .query("opdSlips")
        .withIndex("by_file", (q) => q.eq("fileId", fileId))
        .collect();
      if (remaining.length === 0) {
        const file = await ctx.db.get(fileId);
        if (file) {
          await ctx.storage.delete(file.storageId as Id<"_storage">);
          await ctx.db.delete(fileId);
          deletedFiles++;
        }
      }
    }

    return { deletedSlips: usedSlips.length, deletedFiles };
  },
});
