import { LoadingRegion, Skeleton, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

/** One workout: back link, summary, copy text and share card. */
export default function Loading() {
  return (
    <LoadingRegion>
      <Skeleton className="my-3 h-4 w-20" />
      <SkeletonTitle />
      <SkeletonCard className="h-40" />
      <SkeletonCard className="h-32" />
      <Skeleton className="min-h-touch w-full" />
      <SkeletonCard className="h-64" />
    </LoadingRegion>
  );
}
