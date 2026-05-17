import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import {
  Layers, CheckCircle, Banknote , TrendingUp, FileText, Clock,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartTooltip, ResponsiveContainer, Cell,
} from "recharts";
import { cn } from "@/lib/utils.ts";

type Props = { groupId: Id<"groups"> };

const COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

export default function Dashboard({ groupId }: Props) {
  const data = useQuery(api.dashboard.groupDashboard, { groupId });

  if (data === undefined) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!data) return null;

  const utilizationPct = data.totalSlips > 0
    ? Math.round((data.claimedSlips / data.totalSlips) * 100)
    : 0;

  const memberChartData = [...data.memberStats]
    .sort((a, b) => b.claimedCount - a.claimedCount)
    .map((m) => ({ name: m.name.split(" ")[0], count: m.claimedCount, value: m.claimedValue }));

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          icon={Layers}
          label="Total Slips"
          value={data.totalSlips.toString()}
          sub={`${utilizationPct}% utilized`}
          color="text-primary"
        />
        <StatCard
          icon={CheckCircle}
          label="Available"
          value={data.availableSlips.toString()}
          sub={data.availableValue > 0 ? `₨${data.availableValue.toLocaleString()}` : "—"}
          color="text-green-500"
        />
        <StatCard
          icon={TrendingUp}
          label="Claimed"
          value={data.claimedSlips.toString()}
          sub={data.claimedValue > 0 ? `₨${data.claimedValue.toLocaleString()}` : "—"}
          color="text-blue-500"
        />
        <StatCard
          icon={Banknote}
          label="Pool Value"
          value={data.totalPoolValue > 0 ? `₨${data.totalPoolValue.toLocaleString()}` : "—"}
          sub="Total across slips"
          color="text-amber-500"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Member breakdown */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Claims by Member</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.memberStats.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No activity yet</p>
            ) : (
              <>
                {/* Bar chart */}
                {memberChartData.some((m) => m.count > 0) && (
                  <ResponsiveContainer width="100%" height={120}>
                    <BarChart data={memberChartData} barSize={24}>
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis hide allowDecimals={false} />
                      <RechartTooltip
                        formatter={(val: number, _: string, entry: { payload?: { value?: number } }) => [
                          `${val} slips${(entry.payload?.value ?? 0) > 0 ? ` · ₨${(entry.payload?.value ?? 0).toLocaleString()}` : ""}`,
                          "Claimed",
                        ]}
                        contentStyle={{ fontSize: 11, borderRadius: 6 }}
                      />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {memberChartData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}

                {/* Member rows */}
                <div className="space-y-2">
                  {[...data.memberStats]
                    .sort((a, b) => b.claimedCount - a.claimedCount)
                    .map((m, i) => (
                      <div key={m.userId} className="flex items-center gap-3">
                        <Avatar className="w-7 h-7 shrink-0">
                          <AvatarImage src={m.avatarUrl} />
                          <AvatarFallback
                            className="text-[10px] font-medium"
                            style={{ background: COLORS[i % COLORS.length] + "22", color: COLORS[i % COLORS.length] }}
                          >
                            {(m.name ?? "?").split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium truncate">{m.name ?? "Member"}</span>
                            {m.role === "admin" && (
                              <Badge variant="secondary" className="text-[9px] h-3.5 px-1">Admin</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: data.claimedSlips > 0
                                    ? `${(m.claimedCount / data.claimedSlips) * 100}%`
                                    : "0%",
                                  background: COLORS[i % COLORS.length],
                                }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground shrink-0">
                              {m.claimedCount === 0
                                ? "No claims yet"
                                : `${m.claimedCount} slip${m.claimedCount !== 1 ? "s" : ""}${m.claimedValue > 0 ? ` · ₨${m.claimedValue.toLocaleString()}` : ""}`
                              }
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* File breakdown */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Slips by File</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.slipsByFile.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No files uploaded yet</p>
            ) : (
              data.slipsByFile.map((f) => {
                const pct = f.total > 0 ? Math.round((f.claimed / f.total) * 100) : 0;
                const shortName = f.fileName.replace(/\.pdf$/i, "").slice(0, 40);
                return (
                  <div key={f.fileId} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <FileText className="w-3 h-3 text-muted-foreground shrink-0" />
                        <span className="text-xs font-medium truncate">{shortName}</span>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {f.claimed}/{f.total}
                      </span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.recentActivity.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No claims yet — be the first!</p>
          ) : (
            <div className="space-y-2">
              {data.recentActivity.map((a, i) => (
                <div key={`${a.slipId}-${i}`} className="flex items-center gap-3 py-1.5 border-b last:border-0">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <CheckCircle className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">
                      <span className="font-medium">{a.userName}</span>
                      <span className="text-muted-foreground"> claimed page {a.pageNumber}</span>
                      <span className="text-muted-foreground"> from <span className="text-foreground/70">{a.fileName.replace(/\.pdf$/i, "")}</span></span>
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    {a.effectiveAmount !== undefined && (
                      <p className="text-xs font-medium">₨{a.effectiveAmount.toLocaleString()}</p>
                    )}
                    <p className="text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(a.claimedAt), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type StatCardProps = {
  icon: React.ElementType;
  label: string;
  value: string;
  sub: string;
  color: string;
};

function StatCard({ icon: Icon, label, value, sub, color }: StatCardProps) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold mt-0.5">{value}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
        </div>
        <div className={cn("w-8 h-8 rounded-lg bg-current/10 flex items-center justify-center shrink-0", color)}>
          <Icon className={cn("w-4 h-4", color)} />
        </div>
      </div>
    </Card>
  );
}
