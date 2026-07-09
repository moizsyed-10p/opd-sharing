import { Outlet } from "react-router-dom";
import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";
import { useUser, useClerk } from "@clerk/react";
import { SignInButton } from "@/components/ui/signin.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs.tsx";
import { FileText, LogOut, Upload, Users, Download } from "lucide-react";
import { useSyncUser } from "@/hooks/use-sync-user.ts";

const steps = [
  {
    value: "upload",
    label: "1. Upload",
    icon: Upload,
    title: "Upload your OPD PDF",
    desc: "Upload a multi-page OPD receipt and the app automatically splits it into individual claimable slips.",
  },
  {
    value: "share",
    label: "2. Share",
    icon: Users,
    title: "Share with your group",
    desc: "Invite your team with a code. Everyone sees the same shared pool of slips.",
  },
  {
    value: "claim",
    label: "3. Claim",
    icon: Download,
    title: "Claim & download",
    desc: "Claim slips toward your reimbursement target — Smart Match finds the best combination for you.",
  },
];

export default function AppLayout() {
  useSyncUser();
  const { user } = useUser();
  const { signOut } = useClerk();

  const initials = user?.fullName
    ? user.fullName.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
    : "?";

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-4 sm:px-6 py-3 border-b bg-sidebar text-sidebar-foreground shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-sidebar-primary flex items-center justify-center">
            <FileText className="w-4 h-4 text-sidebar-primary-foreground" />
          </div>
          <span className="font-semibold text-sm text-sidebar-foreground">OPD Manager</span>
        </div>

        <AuthLoading>
          <Skeleton className="h-9 w-24 bg-sidebar-accent" />
        </AuthLoading>
        <Authenticated>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-sidebar-accent/50 transition-colors cursor-pointer">
                <Avatar className="w-7 h-7">
                  <AvatarImage src={user?.imageUrl} />
                  <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="hidden sm:block text-left min-w-0">
                  <p className="text-xs font-medium text-sidebar-foreground truncate max-w-[140px]">
                    {user?.fullName ?? "User"}
                  </p>
                  <p className="text-[10px] text-sidebar-foreground/50 truncate max-w-[140px]">
                    {user?.primaryEmailAddress?.emailAddress}
                  </p>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => signOut()} className="text-destructive cursor-pointer">
                <LogOut className="w-4 h-4 mr-2" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Authenticated>
      </header>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <Authenticated>
          <Outlet />
        </Authenticated>
        <Unauthenticated>
          <div className="flex flex-col items-center px-4 py-10 sm:py-14">
            <div className="text-center space-y-4 max-w-sm w-full">
              <img
                src="/logo.png"
                alt="OPD Sharing"
                className="w-40 h-40 sm:w-52 sm:h-52 mx-auto object-contain"
              />
              <h2 className="text-xl font-semibold">Sign in to continue</h2>
              <p className="text-muted-foreground text-sm">You need to be signed in to use OPD Manager</p>
              <div>
                <SignInButton />
              </div>
              <p className="text-xs text-muted-foreground/70 pt-2">
                Split, share, and claim OPD receipts with your group.
              </p>
            </div>

            {/* How it works */}
            <div className="w-full max-w-sm mt-10">
              <Tabs defaultValue="upload">
                <TabsList className="w-full grid grid-cols-3 h-9">
                  {steps.map((s) => (
                    <TabsTrigger key={s.value} value={s.value} className="text-xs cursor-pointer">
                      {s.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {steps.map((s) => (
                  <TabsContent key={s.value} value={s.value} className="mt-4">
                    <div className="text-center space-y-2 p-4 rounded-lg border bg-muted/20">
                      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center mx-auto">
                        <s.icon className="w-4 h-4 text-primary" />
                      </div>
                      <h3 className="text-sm font-semibold">{s.title}</h3>
                      <p className="text-xs text-muted-foreground">{s.desc}</p>
                    </div>
                  </TabsContent>
                ))}
              </Tabs>
            </div>
          </div>
        </Unauthenticated>
        <AuthLoading>
          <div className="flex items-center justify-center h-full min-h-[70vh]">
            <Skeleton className="h-32 w-64" />
          </div>
        </AuthLoading>
      </main>
    </div>
  );
}
