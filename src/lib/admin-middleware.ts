import { createMiddleware } from "@tanstack/react-start";

/**
 * Function middleware: every admin server function sits behind this.
 * The server module is imported lazily inside the server callback so it can
 * never be pulled into the client bundle.
 */
export const requireAdmin = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { getAdmin } = await import("@/server/auth.server");
  const admin = await getAdmin();
  if (!admin) throw new Error("UNAUTHORIZED");
  return next({ context: { admin } });
});
