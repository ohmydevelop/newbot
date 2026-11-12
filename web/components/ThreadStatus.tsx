import {
  Check,
  CircleAlert,
  CircleHelp,
  CirclePause,
  LoaderCircle,
  Clock3,
} from "lucide-react";
import {
  activityLabels,
  waitingLabel,
  type ThreadActivity,
} from "../../shared/thread-activity";
export default function ThreadStatus({
  activity,
}: {
  activity?: ThreadActivity;
}) {
  const state = activity?.state || "idle";
  const label =
    state === "waiting"
      ? waitingLabel(activity?.waiting)
      : activityLabels[state];
  const Icon =
    state === "completed"
      ? Check
      : state === "failed"
        ? CircleAlert
        : state === "unknown"
          ? CircleHelp
          : state === "interrupted"
            ? CirclePause
            : state === "waiting"
              ? Clock3
              : LoaderCircle;
  return (
    <span
      className={`thread-status status-${state} ${state === "completed" && activity!.seenRevision >= activity!.revision ? "is-read" : ""}`}
      title={
        label + (activity?.waiting ? `（${activity.waiting.count} 项）` : "")
      }
      aria-label={label}
      role="img"
    >
      {state !== "idle" && (
        <Icon
          size={14}
          aria-hidden="true"
          className={state === "running" || state === "preparing" ? "spin" : ""}
        />
      )}
      {state === "waiting" && (activity?.waiting?.count || 0) > 0 && (
        <span className="thread-status-count" aria-hidden="true">
          {activity!.waiting!.count}
        </span>
      )}
    </span>
  );
}
