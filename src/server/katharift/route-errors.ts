import { DatabaseConfigurationError } from "../../lib/db-policy.ts";
import { AuthConfigurationError } from "./auth-policy.ts";

export class ProjectNotFoundError extends Error {
  readonly status = 404;
  readonly code = "PROJECT_NOT_FOUND";

  constructor(message = "Project not found") {
    super(message);
    this.name = "ProjectNotFoundError";
  }
}

export function krErrorResponse(
  err: unknown,
  fallbackMessage: string,
  defaultStatus = 400,
): Response {
  if (err instanceof DatabaseConfigurationError) {
    return Response.json(
      {
        error: err.message,
        code: err.code,
        db_mode: err.dbMode,
      },
      { status: err.status },
    );
  }
  if (err instanceof AuthConfigurationError) {
    return Response.json(
      {
        error: err.message,
        code: err.code,
      },
      { status: err.status },
    );
  }
  if (err instanceof ProjectNotFoundError) {
    return Response.json(
      {
        error: err.message,
        code: err.code,
      },
      { status: err.status },
    );
  }
  const msg = err instanceof Error ? err.message : fallbackMessage;
  const status = msg.includes("lease_token") || msg.includes("worker_session_id") ? 409 : defaultStatus;
  return Response.json({ error: msg }, { status });
}
