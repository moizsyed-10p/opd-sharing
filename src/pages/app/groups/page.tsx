import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ConvexError } from "convex/values";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Users, Plus, Hash, ArrowRight, Shield, User } from "lucide-react";

export default function GroupsPage() {
  const navigate = useNavigate();
  const groups = useQuery(api.groups.listMyGroups, {});
  const createGroup = useMutation(api.groups.createGroup);
  const joinGroup = useMutation(api.groups.joinGroup);

  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupDesc, setGroupDesc] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!groupName.trim()) return;
    setLoading(true);
    try {
      const id = await createGroup({ name: groupName.trim(), description: groupDesc.trim() || undefined });
      toast.success("Group created!");
      setCreateOpen(false);
      setGroupName("");
      setGroupDesc("");
      navigate(`/groups/${id}`);
    } catch (e) {
      toast.error("Failed to create group");
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!inviteCode.trim()) return;
    setLoading(true);
    try {
      const id = await joinGroup({ inviteCode: inviteCode.trim() });
      toast.success("Joined group!");
      setJoinOpen(false);
      setInviteCode("");
      navigate(`/groups/${id}`);
    } catch (e) {
      if (e instanceof ConvexError) {
        const data = e.data as { message: string };
        toast.error(data.message);
      } else {
        toast.error("Failed to join group");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">My Groups</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your OPD reimbursement teams</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
            <DialogTrigger asChild>
              <Button variant="secondary" size="sm" className="cursor-pointer">
                <Hash className="w-4 h-4 mr-2" />
                Join
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Join a Group</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="space-y-1.5">
                  <Label>Invite Code</Label>
                  <Input
                    placeholder="Enter 8-character code"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                    maxLength={8}
                    className="font-mono tracking-widest"
                    onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                  />
                </div>
                <Button onClick={handleJoin} disabled={loading || !inviteCode.trim()} className="w-full cursor-pointer">
                  Join Group
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="cursor-pointer">
                <Plus className="w-4 h-4 mr-2" />
                New Group
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create a Group</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="space-y-1.5">
                  <Label>Group Name</Label>
                  <Input
                    placeholder="e.g. Accounts Team"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Description <span className="text-muted-foreground">(optional)</span></Label>
                  <Input
                    placeholder="Brief description"
                    value={groupDesc}
                    onChange={(e) => setGroupDesc(e.target.value)}
                  />
                </div>
                <Button onClick={handleCreate} disabled={loading || !groupName.trim()} className="w-full cursor-pointer">
                  Create Group
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {groups === undefined ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : groups.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Users /></EmptyMedia>
            <EmptyTitle>No groups yet</EmptyTitle>
            <EmptyDescription>Create a new group or join one with an invite code</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={() => setCreateOpen(true)} className="cursor-pointer">
              <Plus className="w-4 h-4 mr-2" />
              Create Group
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map((group) => group && (
            <Card
              key={group._id}
              className="cursor-pointer hover:shadow-md transition-shadow group"
              onClick={() => navigate(`/groups/${group._id}`)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">{group.name}</CardTitle>
                    {group.description && (
                      <CardDescription className="mt-0.5 text-xs">{group.description}</CardDescription>
                    )}
                  </div>
                  <Badge variant={group.role === "admin" ? "default" : "secondary"} className="text-[10px] h-5">
                    {group.role === "admin" ? <><Shield className="w-2.5 h-2.5 mr-1" />Admin</> : <><User className="w-2.5 h-2.5 mr-1" />Member</>}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="w-3.5 h-3.5" />
                    {group.memberCount} {group.memberCount === 1 ? "member" : "members"}
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
