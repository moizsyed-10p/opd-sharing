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
  ArrowLeft, Copy, Shield, User, LogOut, Users, FileText, Layers, BarChart2, BookmarkCheck,
} from "lucide-react";
import PdfUploader from "./_components/PdfUploader.tsx";
import FileList from "./_components/FileList.tsx";
import SlipPool from "./_components/SlipPool.tsx";
import Dashboard from "./_components/Dashboard.tsx";
import MyClaims from "./_components/MyClaims.tsx";

export default function GroupDetailPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const leaveGroup = useMutation(api.groups.leaveGroup);

  const group = useQuery(api.groups.getGroup, groupId ? { groupId: groupId as Id<"groups"> } : "skip");
  const members = useQuery(api.groups.getGroupMembers, groupId ? { groupId: groupId as Id<"groups"> } : "skip");

  const [membersOpen, setMembersOpen] = useState(false);

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
                {members?.map((m) => m && (
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
                    <Badge variant={m.role === "admin" ? "default" : "outline"} className="text-xs">
                      {m.role}
                    </Badge>
                  </div>
                ))}
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

      {/* Tabs */}
      <Tabs defaultValue="dashboard">
        <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
          <TabsList className="h-8">
            <TabsTrigger value="dashboard" className="cursor-pointer text-xs gap-1.5 h-6">
              <BarChart2 className="w-3.5 h-3.5" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="pool" className="cursor-pointer text-xs gap-1.5 h-6">
              <Layers className="w-3.5 h-3.5" />
              Slip Pool
            </TabsTrigger>
            <TabsTrigger value="my-claims" className="cursor-pointer text-xs gap-1.5 h-6">
              <BookmarkCheck className="w-3.5 h-3.5" />
              My Claims
            </TabsTrigger>
            <TabsTrigger value="files" className="cursor-pointer text-xs gap-1.5 h-6">
              <FileText className="w-3.5 h-3.5" />
              Files
            </TabsTrigger>
          </TabsList>
          <PdfUploader groupId={gId} />
        </div>

        <TabsContent value="dashboard">
          <Dashboard groupId={gId} />
        </TabsContent>

        <TabsContent value="pool">
          <SlipPool groupId={gId} isAdmin={isAdmin} />
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
