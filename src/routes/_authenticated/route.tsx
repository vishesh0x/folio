import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { getAuthState } from "@/lib/auth.functions";

// Runs on the server for first loads (real redirect, no flash of the dashboard
// shell) and via a server function on client navigations.
export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    const s = await getAuthState();
    if (!s.admin) throw redirect({ to: "/auth" });
    return { admin: s.admin };
  },
  component: () => <Outlet />,
});
