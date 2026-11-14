/** Rounded panel geometry shared by navigation and the workspace toggle. */
export function SidebarIcon({
  size = 18,
  side = "left",
}: {
  size?: number;
  side?: "left" | "right";
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="3.5"
        y="4"
        width="17"
        height="16"
        rx="4"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d={
          side === "left"
            ? "M9 7H8a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 8 17h1Z"
            : "M15 7h1a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 17h-1Z"
        }
        fill="currentColor"
      />
    </svg>
  );
}
