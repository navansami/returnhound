"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SignupForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    const { error } = await authClient.signUp.email({
      name,
      email,
      password,
      callbackURL: "/dashboard",
    });
    if (error) {
      setError(error.message ?? "Sign up failed. Make sure your email is @fairmont.com.");
    } else {
      setMessage("Account created — check your email to verify your address, then sign in.");
    }
    setLoading(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Request an account</CardTitle>
        <CardDescription>
          Open to <span className="font-medium text-foreground">@fairmont.com</span> addresses only.
          New accounts start as <span className="font-medium text-foreground">Moderator</span> until
          an admin sets your role.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Full name</Label>
            <Input id="name" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Fairmont email</Label>
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
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {message && <p className="text-sm text-emerald-600">{message}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="size-4 animate-spin" />}
            Create account
          </Button>

          <p className="pt-1 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
