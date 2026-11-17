/**
 * The bundled base catalogue: free-exercise-db (public domain, The Unlicense),
 * vendored at vendor/free-exercise-db and seeded into the database by a
 * generated migration (npm run catalogue:build).
 *
 * Images are not vendored; they are served from the upstream repo pinned to the
 * same commit, and cached on the device by the service worker (public/sw.js, IMAGE_HOSTS). To self-host
 * them, change CATALOGUE_IMAGE_BASE (and IMAGE_HOSTS)
 * (image paths in the database are relative and stay unchanged).
 */

export const FREE_EXERCISE_DB_COMMIT = "f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5";

export const CATALOGUE_IMAGE_BASE = `https://raw.githubusercontent.com/yuhonas/free-exercise-db/${FREE_EXERCISE_DB_COMMIT}/exercises/`;

/** Shown for any exercise without an image of its own (custom exercises, a few catalogue entries). */
export const PLACEHOLDER_IMAGE_URL = "/images/exercise-placeholder.svg";

/** Stored image paths are relative to the catalogue image base unless already absolute URLs or root paths. */
export function resolveImageUrl(path: string): string {
  return /^(https?:)?\//.test(path) ? path : CATALOGUE_IMAGE_BASE + path;
}
