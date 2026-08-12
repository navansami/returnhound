"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    const { error } = await authClient.resetPassword({ newPassword: password, token });
    if (error) {
      setError(error.message ?? "Could not reset your password. The link may have expired.");
    } else {
      setMessage("Password updated — you can now sign in.");
    }
    setLoading(false);
  }

  if (!token) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          This reset link is invalid or expired.{" "}
          <Link href="/forgot-password" className="font-medium text-foreground underline-offset-4 hover:underline">
            Request a new one
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Choose a new password</CardTitle>
        <CardDescription>At least 8 characters.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {message && <p className="text-sm text-emerald-600">{message}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="size-4 animate-spin" />}
            Save new password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
