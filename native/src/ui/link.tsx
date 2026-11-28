import { localSession, setPendingPath } from "../runtime/account";
import type { AnchorHTMLAttributes, ReactNode } from "react";

export default function Link({ href, onClick, target, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode }) {
  const localPath = href.startsWith("/");
  const fragment = href.startsWith("#") ? href.slice(1) : null;
  return <a
    {...props}
    href={localPath ? `#${href}` : href}
    target={localPath ? undefined : target}
    onClick={event => {
      onClick?.(event);
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (fragment !== null) {
        event.preventDefault();
        let id: string;
        try { id = decodeURIComponent(fragment); }
        catch { id = fragment; }
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (localPath) {
        event.preventDefault();
        if (!localSession()) setPendingPath(href + window.location.search);
        window.location.hash = href;
      }
    }}
  />;
}
