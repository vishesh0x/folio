import { useState, type ImgHTMLAttributes } from "react";
import { responsiveImage } from "@/lib/images";
import { safeImageSrc } from "@/lib/url";
import { cn } from "@/lib/utils";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet" | "alt" | "loading"> & {
  src: string | null | undefined;
  /**
   * Required on purpose. Describe the image, or pass `""` ONLY if it is purely
   * decorative (the image then gets role="presentation").
   */
  alt: string;
  /** Largest rendered width in CSS px — picks which variants go in srcset. */
  maxWidth?: number;
  /** Above-the-fold / LCP image: eager + high fetch priority. Everything else lazy-loads. */
  priority?: boolean;
};

/**
 * Image for any content image.
 *  - Uploaded assets (`/media/<key>`) are served as responsive AVIF/WebP/JPEG
 *    via the Cloudflare Images pipeline (srcset + sizes).
 *  - Lazy-loaded and async-decoded unless `priority`.
 *  - Falls back to an accessible placeholder if the file fails to load.
 */
export function Img({ src, alt, maxWidth = 1280, sizes, priority, className, ...rest }: Props) {
  const [failed, setFailed] = useState(false);
  const safe = safeImageSrc(src);
  if (!safe || failed) {
    return (
      <div
        role={alt ? "img" : "presentation"}
        aria-label={alt || undefined}
        className={cn(
          "flex items-center justify-center bg-muted text-xs text-muted-foreground",
          className,
        )}
        style={{
          width: rest.width ? Number(rest.width) : undefined,
          height: rest.height ? Number(rest.height) : undefined,
        }}
      >
        <span aria-hidden>{failed ? "Image unavailable" : ""}</span>
      </div>
    );
  }
  const { src: finalSrc, srcSet } = responsiveImage(safe, { maxWidth });
  return (
    <img
      {...rest}
      src={finalSrc}
      srcSet={srcSet}
      sizes={srcSet ? (sizes ?? "100vw") : undefined}
      alt={alt}
      role={alt === "" ? "presentation" : undefined}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
