// Inline SVG logo — kept in sync with resources/logo.svg (which feeds
// scripts/build-icons.mjs). Duplication avoids renderer ↔ monorepo-root path
// headaches in Electron's file:// renderer context.

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Memora logo"
    >
      <defs>
        <linearGradient id="memora-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4f46e5" />
          <stop offset="60%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="1024" height="1024" rx="224" ry="224" fill="url(#memora-bg)" />
      <g
        stroke="white"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        strokeWidth="82"
      >
        <path d="M 260 780 L 260 280" />
        <path d="M 260 280 L 512 620" />
        <path d="M 512 620 L 764 280" />
        <path d="M 764 280 L 764 780" />
      </g>
      <circle cx="512" cy="700" r="38" fill="white" opacity="0.95" />
    </svg>
  );
}
