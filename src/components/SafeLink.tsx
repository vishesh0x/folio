import type { AnchorHTMLAttributes, ReactNode } from "react";
import { isExternal, safeHref } from "@/lib/url";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string | null | undefined;
  children: ReactNode;
};

/**
 * `<a>` for user-supplied URLs.
 *  - Drops the link entirely if the URL isn't http(s)/mailto/same-site
 *    (blocks `javascript:` and `data:` URLs).
 *  - External links open in a new tab with `noopener noreferrer` and tell
 *    screen-reader users so.
 */
export function SafeLink({ href, children, ...rest }: Props) {
  const safe = safeHref(href);
  if (!safe) return <span className={rest.className}>{children}</span>;
  const external = isExternal(safe);
  return (
    <a
      {...rest}
      href={safe}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
      {external && <span className="sr-only"> (opens in a new tab)</span>}
    </a>
  );
}
