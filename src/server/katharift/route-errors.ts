import { DatabaseConfigurationError } from "../../lib/db-policy.ts";
import { StoryPatchRequestError } from "../../packages/director/story-patch.ts";
import { SkillRegistryUnavailableError } from "../../packages/skill-runtime/registry.ts";
import { AuthConfigurationError, OwnerForbiddenError } from "./auth-policy.ts";

export class ProjectNotFoundError extends Error {
  readonly status = 404;
  readonly code = "PROJECT_NOT_FOUND";

  constructor(message = "Project not found") {
    super(message);
    this.name = "ProjectNotFoundError";
  }
}

export class StoryRevisionConflictError extends Error {
  readonly status = 409;
  readonly code = "STORY_REVISION_CONFLICT";

  constructor(message = "Story revision changed; refresh before proposing a patch.") {
    super(message);
    this.name = "StoryRevisionConflictError";
  }
}

const INTERNAL_FS_ERROR_RE =
  /\b(ENOENT|EACCES|EPERM|EISDIR|ENOTDIR|EMFILE)\b|\/(var\/task|home|tmp|Users|app)\//i;

export function sanitizePublicErrorMessage(rawMessage: string, fallbackMessage: string): string {
  if (!rawMessage || INTERNAL_FS_ERROR_RE.test(rawMessage)) {
    return fallbackMessage;
  }
  return rawMessage;
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
  if (err instanceof AuthConfigurationError || err instanceof OwnerForbiddenError) {
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
  if (err instanceof SkillRegistryUnavailableError) {
    return Response.json(
      {
        error: err.message,
        code: err.code,
      },
      { status: err.status },
    );
  }
  if (err instanceof StoryPatchRequestError || err instanceof StoryRevisionConflictError) {
    return Response.json(
      {
        error: err.message,
        code: err.code,
      },
      { status: err.status },
    );
  }
  const rawMsg = err instanceof Error ? err.message : fallbackMessage;
  const msg = sanitizePublicErrorMessage(rawMsg, fallbackMessage);
  const status = msg.includes("lease_token") || msg.includes("worker_session_id") ? 409 : defaultStatus;
  return Response.json({ error: msg }, { status });
}
