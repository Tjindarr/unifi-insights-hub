import { createFileRoute, Navigate, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { isAuthenticated, mustChangePassword } from "@/lib/auth";
import { UIProvider } from "@/lib/ui-store";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [forceChange, setForceChange] = useState(false);

  useEffect(() => {
    setAuthed(isAuthenticated());
    setForceChange(mustChangePassword());
    setReady(true);
  }, []);

  if (!ready) return <div className="min-h-screen bg-background" />;
  if (!authed) return <Navigate to="/login" />;
  if (forceChange) return <Navigate to="/change-password" />;

  return (
    <UIProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </UIProvider>
  );
}
