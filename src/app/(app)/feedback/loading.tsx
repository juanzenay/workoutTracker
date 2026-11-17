import { LoadingRegion, Skeleton, SkeletonList, SkeletonTitle } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion className="gap-6">
      <SkeletonTitle />
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
      <Skeleton className="h-5 w-40" />
      <SkeletonList rows={3} thumbnail={false} />
    </LoadingRegion>
  );
}
