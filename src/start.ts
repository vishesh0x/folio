import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { renderErrorPage } from "./lib/error-page";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    // Preserve intentional HTTP errors (redirects, notFound, 4xx).
    if (
      error != null &&
      typeof error === "object" &&
      ("statusCode" in error || error instanceof Response)
    ) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Defining src/start.ts opts out of Start's default, so re-add CSRF protection:
// server functions only accept same-origin requests (Sec-Fetch-Site / Origin).
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, csrfMiddleware],
}));
