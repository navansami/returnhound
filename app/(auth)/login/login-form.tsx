"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, Loader2 } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [useMagicLink, setUseMagicLink] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    if (useMagicLink) {
      const { error } = await authClient.signIn.magicLink({ email, callbackURL: next });
      if (error) {
        setError(error.message ?? "Could not send your magic link.");
      } else {
        setMessage("Check your email for your sign-in link.");
      }
    } else {
      const { error } = await authClient.signIn.email({ email, password, callbackURL: next });
      if (error) setError(error.message ?? "Sign in failed.");
    }
    setLoading(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Sign in</CardTitle>
        <CardDescription>
          Use your Fairmont email address. Accounts are restricted to{" "}
          <span className="font-medium text-foreground">@fairmont.com</span>.
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
              autoComplete="email"
              placeholder="name@fairmont.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {!useMagicLink && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  href="/forgot-password"
                  className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          {message && <p className="text-sm text-emerald-600">{message}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="size-4 animate-spin" />}
            {useMagicLink ? "Send magic link" : "Sign in"}
          </Button>

          <button
            type="button"
            onClick={() => {
              setUseMagicLink((v) => !v);
              setError("");
              setMessage("");
            }}
            className="w-full text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            {useMagicLink ? "Use password instead" : "Sign in with a magic link instead"}
          </button>

          <div className="pt-1 text-center text-sm text-muted-foreground">
            No account yet?{" "}
            <Link href="/signup" className="font-medium text-foreground underline-offset-4 hover:underline">
              Request one <ArrowRight className="inline size-3.5" />
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
