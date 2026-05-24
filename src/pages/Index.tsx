import { useNavigate } from "react-router-dom";
import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";
import { SignInButton } from "@/components/ui/signin.tsx";
import { Button } from "@/components/ui/button.tsx";
import { FileText, Users, ShieldCheck, Zap, ArrowRight } from "lucide-react";

const features = [
  {
    icon: FileText,
    title: "Bulk PDF Upload",
    desc: "Upload multi-page OPD receipts and auto-split them into individual slips.",
  },
  {
    icon: Users,
    title: "Team Sharing",
    desc: "Share a pool of slips across your group. Invite teammates with a code.",
  },
  {
    icon: ShieldCheck,
    title: "No Duplicates",
    desc: "Atomic claim logic ensures each slip can only be downloaded once.",
  },
  {
    icon: Zap,
    title: "Smart Matching",
    desc: "Auto-select the best combination of slips to hit your reimbursement target.",
  },
];

export default function Index() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="OPD Sharing" className="w-7 h-7" />
          <span className="font-semibold text-sm">OPD Manager</span>
        </div>
        <AuthLoading>
          <div className="w-24 h-8 bg-muted animate-pulse rounded-md" />
        </AuthLoading>
        <Unauthenticated>
          <SignInButton />
        </Unauthenticated>
        <Authenticated>
          <Button size="sm" onClick={() => navigate("/groups")} className="cursor-pointer">
            Go to App
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </Authenticated>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-20 text-center">
        <div className="inline-flex items-center gap-1.5 bg-primary/10 text-primary text-xs font-medium px-3 py-1 rounded-full mb-6">
          <Zap className="w-3 h-3" />
          OPD Reimbursement, Simplified
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight max-w-2xl text-balance mb-5">
          Distribute OPD slips fairly across your team
        </h1>
        <p className="text-lg text-muted-foreground max-w-xl text-balance mb-8">
          Upload bulk receipts, auto-split them, and let teammates claim slips — with zero duplicates and maximum utilization.
        </p>
        <div className="flex items-center gap-3">
          <Unauthenticated>
            <SignInButton />
          </Unauthenticated>
          <Authenticated>
            <Button onClick={() => navigate("/groups")} className="cursor-pointer">
              Open App
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Authenticated>
        </div>
      </main>

      {/* Features */}
      <section className="border-t px-6 py-16">
        <div className="max-w-4xl mx-auto grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="space-y-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <Icon className="w-4 h-4 text-primary" />
              </div>
              <h3 className="font-semibold text-sm">{title}</h3>
              <p className="text-sm text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t px-6 py-4 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} OPD Manager. All rights reserved.
      </footer>
    </div>
  );
}
