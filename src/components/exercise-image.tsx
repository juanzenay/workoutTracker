"use client";

import { PLACEHOLDER_IMAGE_URL } from "@/domain/catalogue";

/**
 * Exercise thumbnails share one aspect ratio so catalogue, custom and imported exercises look consistent.
 * An image that can't load (offline and not yet cached by the service worker) falls back to the placeholder.
 */
export function ExerciseImage({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={(e) => {
        if (!e.currentTarget.src.endsWith(PLACEHOLDER_IMAGE_URL)) e.currentTarget.src = PLACEHOLDER_IMAGE_URL;
      }}
      className={`aspect-[4/3] rounded-control bg-surface-raised object-cover ${className}`}
    />
  );
}
