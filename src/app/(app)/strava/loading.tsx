import { LoadingRegion, Skeleton, SkeletonCard, SkeletonList, SkeletonTitle } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion>
      <SkeletonTitle />
      <Skeleton className="h-5 w-full" />
      <SkeletonCard className="h-28" />
      <SkeletonCard className="h-28" />
      <Skeleton className="h-7 w-1/3" />
      <SkeletonList rows={3} thumbnail={false} />
    </LoadingRegion>
  );
}
