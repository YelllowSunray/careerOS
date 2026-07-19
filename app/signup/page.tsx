"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/auth-provider";
import { formatAuthError } from "@/lib/auth/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardTitle } from "@/components/ui/card";

export default function SignupPage() {
  const { signUp, signInWithGoogle } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await signUp(email, password);
    } catch (e) {
      console.error("[Signup]", e);
      setError(formatAuthError(e, "Could not create account"));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError("");
    try {
      await signInWithGoogle();
    } catch (e) {
      console.error("[Signup Google]", e);
      setError(formatAuthError(e, "Google sign-in failed"));
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardTitle className="mb-1">Create account</CardTitle>
        <p className="mb-6 text-sm text-zinc-500">
          Start your AI-powered job search
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Creating..." : "Create account"}
          </Button>
        </form>
        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-zinc-200" />
          <span className="text-xs text-zinc-400">or</span>
          <div className="h-px flex-1 bg-zinc-200" />
        </div>
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => void handleGoogle()}
        >
          Continue with Google
        </Button>
        <p className="mt-4 text-center text-sm text-zinc-500">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-zinc-900">
            Sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}
