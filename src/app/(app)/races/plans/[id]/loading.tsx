import { LoadingRegion, Skeleton, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion>
      <Skeleton className="h-4 w-16" />
      <div className="flex flex-col gap-1">
        <SkeletonTitle />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <SkeletonCard className="h-40" />
      <SkeletonCard className="h-40" />
      <SkeletonCard className="h-40" />
    </LoadingRegion>
  );
}
