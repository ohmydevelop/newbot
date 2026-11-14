import { matchesOAuthAttempt } from "../shared/mcp-oauth";
import { useEffect, useRef } from "react";
import { useApp } from "./store";
export type OAuthAttempt = { id: string; url: string; loginId?: string };
/** Only the completion for this exact attempt may consume its link or change its UI. */
export function useMcpOAuthCompletion(
  attempt: OAuthAttempt | null,
  onComplete: (success: boolean, id: string) => void,
) {
  const completion = useApp((s) =>
    attempt?.loginId ? s.mcpOAuthCompletions[attempt.loginId] : undefined,
  );
  const handled = useRef<string | undefined>(undefined);
  const callback = useRef(onComplete);
  callback.current = onComplete;
  useEffect(() => {
    if (
      !attempt ||
      !completion ||
      !matchesOAuthAttempt(attempt, completion) ||
      handled.current === attempt.loginId
    )
      return;
    handled.current = attempt.loginId;
    callback.current(completion.success, attempt.id);
  }, [attempt, completion]);
}
