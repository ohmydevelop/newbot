export function matchesOAuthAttempt(
  attempt: { id: string; loginId?: string } | null,
  completion: { name: string; loginId?: string | null } | null,
) {
  return (
    !!attempt?.loginId &&
    !!completion &&
    attempt.id === completion.name &&
    attempt.loginId === completion.loginId
  );
}
