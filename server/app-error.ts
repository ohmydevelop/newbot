import { PublicError } from "./public-error.js";
import { appIssue, type AppIssueCode } from "../shared/mcp-apps.js";
export class AppFailure extends PublicError {
  constructor(
    message: string,
    public statusCode: number,
    public appIssue: { code: AppIssueCode },
  ) {
    super(message);
  }
}
export function appFail(
  code: AppIssueCode,
  message: string,
  statusCode = 409,
): never {
  throw new AppFailure(message, statusCode, { code });
}
export const publicAppIssue = (error: unknown) =>
  error instanceof AppFailure ? appIssue(error.appIssue) : null;
