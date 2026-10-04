import { createFileRoute } from "@tanstack/react-router";
import { getEnv } from "@/server/env.server";
import { handleUpload } from "@/server/upload.server";

export const Route = createFileRoute("/api/admin/upload")({
  server: {
    handlers: {
      POST: ({ request }) => handleUpload(request, getEnv()),
    },
  },
});
