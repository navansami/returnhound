"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    const { error } = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    if (error) {
      setError(error.message ?? "Could not send a reset link.");
    } else {
      setMessage("If that address is registered, a password reset link is on its way.");
    }
    setLoading(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Reset password</CardTitle>
        <CardDescription>
          Enter your Fairmont email and we’ll send you a reset link.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              placeholder="name@fairmont.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {message && <p className="text-sm text-emerald-600">{message}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="size-4 animate-spin" />}
            Send reset link
          </Button>

          <p className="pt-1 text-center text-sm">
            <Link href="/login" className="inline-flex items-center gap-1 text-muted-foreground underline-offset-4 hover:underline">
              <ArrowLeft className="size-3.5" /> Back to sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
