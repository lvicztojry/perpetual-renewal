import type { SVGProps } from "react";

/** A suspended bell inside an unfinished ring: a voice and its returning echo. */
export function RenewalEmblem(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" {...props}>
      <g stroke="currentColor" strokeWidth="1.25" strokeLinecap="square" strokeLinejoin="miter">
        <path d="M15 14a25 25 0 0 0 0 36M49 14a25 25 0 0 1 0 36" />
        <path d="M28 10h8v7h-8zM32 4v6M21 30c0-8 4-13 11-13s11 5 11 13v9l4 6H17l4-6z" />
        <path d="M24 26h16M21 39h22M32 45v9M28 54l4 4 4-4-4-4zM26 62h12" />
      </g>
    </svg>
  );
}
