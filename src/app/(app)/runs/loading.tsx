import { LoadingRegion, Skeleton, SkeletonCard, SkeletonList, SkeletonTitle } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion>
      <SkeletonTitle />
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <SkeletonCard className="h-40" />
      <Skeleton className="h-7 w-1/3" />
      <SkeletonList rows={4} thumbnail={false} />
    </LoadingRegion>
  );
}
