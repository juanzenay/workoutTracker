import { LoadingRegion, Skeleton, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

/** One discarded workout: back link, header, read-only note, exercises and Restore. */
export default function Loading() {
  return (
    <LoadingRegion>
      <Skeleton className="my-3 h-4 w-20" />
      <SkeletonTitle />
      <Skeleton className="h-4 w-1/3" />
      <SkeletonCard className="h-48" />
      <SkeletonCard className="h-48" />
      <Skeleton className="min-h-touch w-full" />
    </LoadingRegion>
  );
}
