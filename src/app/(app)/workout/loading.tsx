import { LoadingRegion, Skeleton, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

/** The logger: title, the add-exercise and routine controls, and a few exercise cards. */
export default function Loading() {
  return (
    <LoadingRegion>
      <SkeletonTitle />
      <Skeleton className="min-h-touch-lg w-full" />
      <SkeletonCard className="h-48" />
      <SkeletonCard className="h-48" />
      <Skeleton className="min-h-touch-lg w-full" />
    </LoadingRegion>
  );
}
