import { Link, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ThemedToaster } from "@/components/ThemedToaster";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAuthState, login, setupAdmin } from "@/lib/auth.functions";
import { ThemeToggle } from "@/lib/theme";
import { MIN_PASSWORD } from "@/lib/constants";
import { errMsg } from "@/components/dash/api";

export const Route = createFileRoute("/auth")({
  beforeLoad: async () => {
    const s = await getAuthState();
    if (s.admin) throw redirect({ to: "/dashboard" });
    return { needsSetup: s.needsSetup, setupAvailable: s.setupAvailable };
  },
  head: () => ({
    meta: [{ title: "Sign in · Folio" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { needsSetup, setupAvailable } = Route.useRouteContext();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (needsSetup) await setupAdmin({ data: { email, password, setupToken } });
      else await login({ data: { email, password } });
      await navigate({ to: "/dashboard" });
    } catch (err) {
      const m = errMsg(err);
      setError(m);
      toast.error(m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="flex min-h-screen items-center justify-center bg-background px-5"
    >
      <ThemedToaster />
      <div className="absolute right-5 top-5">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        <Link
          to="/"
          className="inline-block py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to site
        </Link>
        <h1 className="mt-6 font-display text-4xl">
          {needsSetup ? "Set up Folio" : "Welcome back"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {needsSetup
            ? "Create the owner account. This only works once, and needs your ADMIN_SETUP_TOKEN."
            : "Sign in to manage your site."}
        </p>
        {needsSetup && !setupAvailable && (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            No <code className="font-mono">ADMIN_SETUP_TOKEN</code> secret is configured. Add it to{" "}
            <code className="font-mono">.dev.vars</code> (local) or run{" "}
            <code className="font-mono">wrangler secret put ADMIN_SETUP_TOKEN</code>, then reload.
          </p>
        )}
        <form onSubmit={submit} className="mt-8 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw">Password</Label>
            <Input
              id="pw"
              type="password"
              autoComplete={needsSetup ? "new-password" : "current-password"}
              required
              minLength={needsSetup ? MIN_PASSWORD : 1}
              aria-describedby={needsSetup ? "pw-hint" : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {needsSetup && (
              <p id="pw-hint" className="text-xs text-muted-foreground">
                At least {MIN_PASSWORD} characters.
              </p>
            )}
          </div>
          {needsSetup && (
            <div className="space-y-1.5">
              <Label htmlFor="token">Setup token</Label>
              <Input
                id="token"
                type="password"
                autoComplete="off"
                required
                value={setupToken}
                onChange={(e) => setSetupToken(e.target.value)}
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <button disabled={busy} className="btn-primary w-full">
            {busy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
            {needsSetup ? "Create account" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
