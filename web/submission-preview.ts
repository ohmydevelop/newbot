import type { Turn } from "../shared/types";
export type SubmissionPreview = {
  text: string;
  files: { id: string; name: string; mime?: string }[];
  beforeTurns: string[];
  turnId?: string;
};
/** A native echo takes over the local placeholder without duplicating the bubble. */
export function submissionPreviewVisible(
  preview: SubmissionPreview,
  turns: Turn[],
) {
  return !turns.some(
    (turn) =>
      (!preview.beforeTurns.includes(turn.id) || turn.id === preview.turnId) &&
      turn.items.some(
        (item) =>
          item.type === "userMessage" &&
          (turn.id === preview.turnId ||
            (item.content || [])
              .filter((c: any) => c.type === "text")
              .map((c: any) => c.text)
              .join("\n")
              .trim() === preview.text.trim()),
      ),
  );
}
