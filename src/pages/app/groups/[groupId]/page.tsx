import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog.tsx";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog.tsx";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select.tsx";
import {
  ArrowLeft, Copy, Shield, User, LogOut, Users, FileText, Layers, BarChart2, BookmarkCheck, UserX,
} from "lucide-react";
import { ConvexError } from "convex/values";
import PdfUploader from "./_components/PdfUploader.tsx";
import FileList from "./_components/FileList.tsx";
import SlipPool from "./_components/SlipPool.tsx";
import Dashboard from "./_components/Dashboard.tsx";
import MyClaims from "./_components/MyClaims.tsx";
import ClaimReminderBanner from "./_components/ClaimReminderBanner.tsx";

export default function GroupDetailPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const leaveGroup = useMutation(api.groups.leaveGroup);
  const updateMemberPermission = useMutation(api.groups.updateMemberPermission);
  const removeMember = useMutation(api.groups.removeMember);

  const group = useQuery(api.groups.getGroup, groupId ? { groupId: groupId as Id<"groups"> } : "skip");
  const members = useQuery(api.groups.getGroupMembers, groupId ? { groupId: groupId as Id<"groups"> } : "skip");
  const currentUser = useQuery(api.users.getCurrentUser, {});

  const [membersOpen, setMembersOpen] = useState(false);
  const [tab, setTab] = useState("dashboard");

  const copyInviteCode = () => {
    if (group?.inviteCode) {
      navigator.clipboard.writeText(group.inviteCode);
      toast.success("Invite code copied!");
    }
  };

  const handleLeave = async () => {
    if (!groupId) return;
    try {
      await leaveGroup({ groupId: groupId as Id<"groups"> });
      toast.success("Left group");
      navigate("/groups");
    } catch {
      toast.error("Failed to leave group");
    }
  };

  const handlePermissionChange = async (
    userId: Id<"users">,
    permission: "upload_only" | "claim_and_upload"
  ) => {
    if (!groupId) return;
    try {
      await updateMemberPermission({ groupId: groupId as Id<"groups">, userId, permission });
      toast.success("Permission updated");
    } catch (err) {
      const msg = err instanceof ConvexError
        ? (err.data as { message: string }).message
        : "Failed to update permission";
      toast.error(msg);
    }
  };

  const handleRemoveMember = async (userId: Id<"users">) => {
    if (!groupId) return;
    try {
      await removeMember({ groupId: groupId as Id<"groups">, userId });
      toast.success("Member removed");
    } catch (err) {
      const msg = err instanceof ConvexError
        ? (err.data as { message: string }).message
        : "Failed to remove member";
      toast.error(msg);
    }
  };

  if (group === undefined) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!group) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        Group not found or you don't have access.
      </div>
    );
  }

  const gId = groupId as Id<"groups">;
  const isAdmin = group.role === "admin";

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <button
        onClick={() => navigate("/groups")}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-5 cursor-pointer transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to groups
      </button>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold">{group.name}</h1>
            <Badge variant={isAdmin ? "default" : "secondary"} className="text-xs">
              {isAdmin
                ? <><Shield className="w-3 h-3 mr-1" />Admin</>
                : <><User className="w-3 h-3 mr-1" />Member</>}
            </Badge>
          </div>
          {group.description && (
            <p className="text-muted-foreground text-sm mt-1">{group.description}</p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Dialog open={membersOpen} onOpenChange={setMembersOpen}>
            <DialogTrigger asChild>
              <Button variant="secondary" size="sm" className="cursor-pointer">
                <Users className="w-4 h-4 mr-2" />
                Members
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Group Members</DialogTitle>
              </DialogHeader>
              <div className="space-y-2 pt-2">
                {members?.map((m) => {
                  if (!m) return null;
                  const isSelf = m.userId === currentUser?._id;
                  return (
                    <div key={m._id} className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50">
                      <Avatar className="w-8 h-8">
                        <AvatarImage src={m.user?.avatarUrl} />
                        <AvatarFallback className="text-xs bg-primary/10 text-primary">
                          {m.user?.name?.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2) ?? "?"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{m.user?.name ?? "Unknown"}</p>
                        <p className="text-xs text-muted-foreground truncate">{m.user?.email}</p>
                      </div>
                      <Badge variant={m.role === "admin" ? "default" : "outline"} className="text-xs shrink-0">
                        {m.role}
                      </Badge>
                      {isAdmin ? (
                        <Select
                          value={m.permission}
                          onValueChange={(v) =>
                            handlePermissionChange(m.userId, v as "upload_only" | "claim_and_upload")
                          }
                        >
                          <SelectTrigger size="sm" className="w-[130px] text-xs shrink-0 cursor-pointer">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="claim_and_upload">Claim & upload</SelectItem>
                            <SelectItem value="upload_only">Upload only</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        m.permission === "upload_only" && (
                          <Badge variant="outline" className="text-[10px] shrink-0">Upload only</Badge>
                        )
                      )}
                      {isAdmin && !isSelf && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="cursor-pointer h-7 w-7 p-0 text-destructive hover:text-destructive shrink-0"
                            >
                              <UserX className="w-3.5 h-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove {m.user?.name ?? "this member"}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                They will lose access to this group. Their claim and upload history is preserved.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleRemoveMember(m.userId)}
                                className="cursor-pointer bg-destructive hover:bg-destructive/90"
                              >
                                Remove
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  );
                })}
              </div>
            </DialogContent>
          </Dialog>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive cursor-pointer">
                <LogOut className="w-4 h-4 mr-2" />
                Leave
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Leave group?</AlertDialogTitle>
                <AlertDialogDescription>
                  You will lose access to all OPD slips in this group.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleLeave} className="cursor-pointer bg-destructive hover:bg-destructive/90">
                  Leave Group
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Invite Code */}
      <div className="bg-muted/40 border rounded-lg p-4 mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Invite Code</p>
          <p className="font-mono text-xl font-bold tracking-widest mt-0.5">{group.inviteCode}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={copyInviteCode} className="cursor-pointer shrink-0">
          <Copy className="w-4 h-4 mr-2" />
          Copy
        </Button>
      </div>
      
      <ClaimReminderBanner groupId={gId} onGoToPool={() => setTab("pool")} />

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex items-center justify-between mb-4 gap-2">
          <TabsList className="h-8 overflow-x-auto flex-1 justify-start">
            <TabsTrigger value="dashboard" className="cursor-pointer text-xs gap-1 h-6 px-2 shrink-0">
              <BarChart2 className="w-3 h-3" />
              <span className="hidden sm:inline">Dashboard</span>
              <span className="sm:hidden">Dash</span>
            </TabsTrigger>
            <TabsTrigger value="pool" className="cursor-pointer text-xs gap-1 h-6 px-2 shrink-0">
              <Layers className="w-3 h-3" />
              <span className="hidden sm:inline">Slip Pool</span>
              <span className="sm:hidden">Pool</span>
            </TabsTrigger>
            <TabsTrigger value="my-claims" className="cursor-pointer text-xs gap-1 h-6 px-2 shrink-0">
              <BookmarkCheck className="w-3 h-3" />
              <span className="hidden sm:inline">My Claims</span>
              <span className="sm:hidden">Claims</span>
            </TabsTrigger>
            <TabsTrigger value="files" className="cursor-pointer text-xs gap-1 h-6 px-2 shrink-0">
              <FileText className="w-3 h-3" />
              Files
            </TabsTrigger>
          </TabsList>
          <PdfUploader groupId={gId} />
        </div>
  

        <TabsContent value="dashboard">
          <Dashboard groupId={gId} />
        </TabsContent>

        <TabsContent value="pool">
          <SlipPool groupId={gId} isAdmin={isAdmin} canClaim={group.permission !== "upload_only"} />
        </TabsContent>

        <TabsContent value="my-claims">
          <MyClaims groupId={gId} />
        </TabsContent>

        <TabsContent value="files">
          <FileList groupId={gId} isAdmin={isAdmin} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
