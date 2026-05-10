import { Outlet, Link, useLocation } from "react-router-dom";
import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";
import { useUser, useClerk } from "@clerk/react";
import { SignInButton } from "@/components/ui/signin.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { Users, FileText, LogOut } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { useSyncUser } from "@/hooks/use-sync-user.ts";

const navItems = [
  { href: "/groups", label: "Groups", icon: Users },
];

export default function AppLayout() {
  useSyncUser(); // ← add this line
  const location = useLocation();
 const { user } = useUser();
const { signOut } = useClerk();

 const initials = user?.fullName
  ? user.fullName.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
  : "?";

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="hidden md:flex flex-col w-60 border-r bg-sidebar text-sidebar-foreground">
        <div className="p-5 border-b border-sidebar-border">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-sidebar-primary flex items-center justify-center">
              <FileText className="w-4 h-4 text-sidebar-primary-foreground" />
            </div>
            <span className="font-semibold text-sm text-sidebar-foreground">OPD Manager</span>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              to={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors cursor-pointer",
                location.pathname === href || location.pathname.startsWith(href + "/")
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </Link>
          ))}
        </nav>

        <div className="p-3 border-t border-sidebar-border">
          <AuthLoading>
            <Skeleton className="h-9 w-full bg-sidebar-accent" />
          </AuthLoading>
          <Unauthenticated>
            <SignInButton />
          </Unauthenticated>
          <Authenticated>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md hover:bg-sidebar-accent/50 transition-colors cursor-pointer">
                  <Avatar className="w-7 h-7">
                    <AvatarImage src={user?.imageUrl} />
                    <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-xs font-medium text-sidebar-foreground truncate">
                      {user?.fullName ?? "User"}
                    </p>
                    <p className="text-[10px] text-sidebar-foreground/50 truncate">
                      {user?.primaryEmailAddress?.emailAddress}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => signOut()} className="text-destructive cursor-pointer">
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </Authenticated>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto pb-16 md:pb-0">
        <Authenticated>
          <Outlet />
        </Authenticated>
        <Unauthenticated>
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-4">
              <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mx-auto">
                <FileText className="w-7 h-7 text-primary" />
              </div>
              <h2 className="text-xl font-semibold">Sign in to continue</h2>
              <p className="text-muted-foreground text-sm">You need to be signed in to use OPD Manager</p>
              <SignInButton />
            </div>
          </div>
        </Unauthenticated>
      </main>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 flex justify-around border-t bg-sidebar md:hidden px-4 py-2">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            to={href}
            className={cn(
              "flex flex-col items-center gap-1 py-1 px-3 rounded-md transition-colors cursor-pointer",
              location.pathname.startsWith(href)
                ? "text-sidebar-primary"
                : "text-sidebar-foreground/50"
            )}
          >
            <Icon className="w-5 h-5" />
            <span className="text-[10px]">{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
