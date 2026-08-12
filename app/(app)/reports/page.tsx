import { format } from "date-fns";
import Link from "next/link";

import { SendReportButton } from "@/components/send-report-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { STORAGE_LABELS } from "@/lib/labels";
import { gatherReportData, getReportRules } from "@/lib/reports";
import { canRunReports, type Role } from "@/lib/rbac";
import { requireUser } from "@/lib/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const session = await requireUser();
  const role = session.user.role as Role;
  if (!canRunReports(role)) redirect("/dashboard");

  const [data, rules] = await Promise.all([gatherReportData(), getReportRules()]);

  // Days held, computed relative to the report's generation time (server-side,
  // so rendering stays pure).
  const dueRows = data.due.map((i) => ({
    ...i,
    heldDays: Math.floor((data.generatedAt.getTime() - i.foundAt.getTime()) / 86_400_000),
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Reports</h1>
          <p className="text-sm text-muted-foreground">
            What the daily email covers. Sent to {rules.recipients.length > 0 ? rules.recipients.join(", ") : "no one yet"}.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {rules.recipients.length === 0 && (
            <Button asChild variant="outline">
              <Link href="/settings">Add recipients</Link>
            </Button>
          )}
          <SendReportButton recipients={rules.recipients} />
        </div>
      </div>

      {/* At-a-glance */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-semibold">{data.heldCount}</p>
            <p className="text-xs text-muted-foreground">Items held</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-semibold">{data.newEntryCount}</p>
            <p className="text-xs text-muted-foreground">New entries (24h)</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-semibold">{data.collectedCount}</p>
            <p className="text-xs text-muted-foreground">Collected (24h)</p>
          </CardContent>
        </Card>
        <Card className={data.due.length > 0 ? "border-destructive/50" : ""}>
          <CardContent className="p-4">
            <p className="text-2xl font-semibold">{data.due.length}</p>
            <p className="text-xs text-muted-foreground">Due for police (&gt;{rules.policeAfterDays}d)</p>
          </CardContent>
        </Card>
      </div>

      {/* Due for police */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Due for Dubai Police</CardTitle>
          <CardDescription>
            Items still held more than {rules.policeAfterDays} days after being found. Hand these over with the item
            pictures from each entry.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>RS</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Found at</TableHead>
                <TableHead>Found date</TableHead>
                <TableHead>Held</TableHead>
                <TableHead>Storage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dueRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    Nothing due.
                  </TableCell>
                </TableRow>
              ) : (
                dueRows.map((i) => (
                  <TableRow key={i.itemId}>
                    <TableCell className="font-mono">
                      <Link href={`/entries/${i.entryId}`} className="hover:underline">
                        {i.rsNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{i.itemName}</TableCell>
                    <TableCell className="max-w-40 truncate">{i.foundLocation}</TableCell>
                    <TableCell>{format(i.foundAt, "dd MMM yyyy")}</TableCell>
                    <TableCell>
                      <Badge variant="destructive">{i.heldDays} days</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={i.isValuable ? "default" : "outline"}>{STORAGE_LABELS[i.storageLocation]}</Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Food / alcohol expiry */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Food &amp; alcohol past {rules.foodExpiryHours}-hour window</CardTitle>
          <CardDescription>These are held for 24 hours only — dispose of or hand over before they spoil.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>RS</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Found at</TableHead>
                <TableHead>Found date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.expiring.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    Nothing past its window.
                  </TableCell>
                </TableRow>
              ) : (
                data.expiring.map((i) => (
                  <TableRow key={i.itemId}>
                    <TableCell className="font-mono">
                      <Link href={`/entries/${i.entryId}`} className="hover:underline">
                        {i.rsNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{i.itemName}</TableCell>
                    <TableCell className="max-w-40 truncate">{i.foundLocation}</TableCell>
                    <TableCell>{format(i.foundAt, "dd MMM yyyy, HH:mm")}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Where things are held */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Where things are held</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Location</TableHead>
                <TableHead className="text-right">Items</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.heldByStorage.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="text-muted-foreground">
                    Nothing held.
                  </TableCell>
                </TableRow>
              ) : (
                data.heldByStorage.map((s) => (
                  <TableRow key={s.storageLocation}>
                    <TableCell>{STORAGE_LABELS[s.storageLocation]}</TableCell>
                    <TableCell className="text-right">{s.count}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
