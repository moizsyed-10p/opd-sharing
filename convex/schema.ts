import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  }).index("by_token", ["tokenIdentifier"]),

  groups: defineTable({
    name: v.string(),
    inviteCode: v.string(),
    createdBy: v.id("users"),
    description: v.optional(v.string()),
  }).index("by_invite_code", ["inviteCode"]),

  groupMembers: defineTable({
    groupId: v.id("groups"),
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("member")),
    permission: v.optional(
      v.union(v.literal("upload_only"), v.literal("claim_and_upload"))
    ),
  })
    .index("by_group", ["groupId"])
    .index("by_user", ["userId"])
    .index("by_group_and_user", ["groupId", "userId"]),

  opdFiles: defineTable({
    groupId: v.id("groups"),
    uploadedBy: v.id("users"),
    originalName: v.string(),
    storageId: v.string(),
    pageCount: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("done"),
      v.literal("error")
    ),
  }).index("by_group", ["groupId"]),

  opdSlips: defineTable({
    groupId: v.id("groups"),
    fileId: v.id("opdFiles"),
    pageNumber: v.number(),
    storageId: v.string(),
    amount: v.optional(v.number()),
    amountOverride: v.optional(v.number()),
    isUsed: v.boolean(),
    usedBy: v.optional(v.id("users")),
    usedAt: v.optional(v.string()),
  })
    .index("by_group", ["groupId"])
    .index("by_file", ["fileId"])
    .index("by_group_and_used", ["groupId", "isUsed"]),

  userOpdUsage: defineTable({
    userId: v.id("users"),
    slipId: v.id("opdSlips"),
    groupId: v.id("groups"),
    claimedAt: v.string(),
  })
    .index("by_user", ["userId"])
    .index("by_slip", ["slipId"])
    .index("by_group_and_user", ["groupId", "userId"])
    .index("by_slip_and_user", ["slipId", "userId"]),
});
