import { createFileRoute, useNavigate, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { Shield } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isAuthenticated, mustChangePassword, signIn } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [{ title: "Sign in — UniFi Dashboard" }],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (isAuthenticated()) {
    return <Navigate to={mustChangePassword() ? "/change-password" : "/"} />;
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = signIn(username, password);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    navigate({ to: res.mustChange ? "/change-password" : "/" });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8">
          <div className="h-9 w-9 rounded-md bg-primary/15 flex items-center justify-center">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight">UniFi Dashboard</div>
            <div className="text-xs text-muted-foreground">Sign in to continue</div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" className="w-full">Sign in</Button>
        </form>

        <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">
          Default credentials: <code className="font-mono">admin</code> /{" "}
          <code className="font-mono">admin</code>. You'll be asked to set a new
          password on first sign in.
        </p>
      </div>
    </div>
  );
}
