// Clean geometric logo — rounded square with an "M" inside. Uses the CSS
// accent variable so it follows light/dark + any future theme changes.
// The OS icon at resources/logo.svg keeps its own color-saturated design
// for readability at small dock sizes.

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Memora"
    >
      <rect
        x="0"
        y="0"
        width="32"
        height="32"
        rx="7"
        ry="7"
        fill="var(--accent, #6366f1)"
      />
      <path
        d="M 8 23 L 8 9 L 13 9 L 16 15 L 19 9 L 24 9 L 24 23"
        fill="none"
        stroke="var(--accent-fg, #ffffff)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
