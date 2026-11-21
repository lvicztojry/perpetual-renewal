import type { AnchorHTMLAttributes, ReactNode } from "react";
export default function Link({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode }) {
  return <a {...props} href={href.startsWith("/") ? `#${href}` : href}>{children}</a>;
}
