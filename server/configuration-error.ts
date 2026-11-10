import { PublicError } from "./public-error.js";
import {
  configurationIssue,
  type ConfigurationIssue,
} from "../shared/configuration.js";
export class ConfigurationFailure extends PublicError {
  constructor(
    message: string,
    public statusCode: number,
    public configurationIssue: ConfigurationIssue,
  ) {
    super(message);
  }
}
export function configFail(
  message: string,
  statusCode: number,
  code: ConfigurationIssue["code"],
  persistence: ConfigurationIssue["persistence"] = "unchanged",
  recovery: ConfigurationIssue["recovery"] = "read",
): never {
  throw new ConfigurationFailure(message, statusCode, {
    code,
    persistence,
    recovery,
  });
}
export const publicConfigurationIssue = (error: unknown) =>
  error instanceof ConfigurationFailure
    ? configurationIssue(error.configurationIssue)
    : null;
