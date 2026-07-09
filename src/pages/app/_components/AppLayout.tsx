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
import { FileText, LogOut } from "lucide-react";
import { useSyncUser } from "@/hooks/use-sync-user.ts";

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
        <Unauthenticated>
          <SignInButton />
        </Unauthenticated>
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
          <div className="flex items-center justify-center h-full min-h-[70vh]">
            <div className="text-center space-y-4">
              <img src="/logo.svg" alt="OPD Sharing" className="w-14 h-14 mx-auto" />
              <h2 className="text-xl font-semibold">Sign in to continue</h2>
              <p className="text-muted-foreground text-sm">You need to be signed in to use OPD Manager</p>
              <SignInButton />
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
