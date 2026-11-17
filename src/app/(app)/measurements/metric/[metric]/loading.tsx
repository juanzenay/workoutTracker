import { LoadingRegion, Skeleton, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion>
      <Skeleton className="h-12 w-24 bg-transparent" />
      <SkeletonTitle />
      <div className="grid grid-cols-3 gap-2">
        <SkeletonCard className="h-16" />
        <SkeletonCard className="h-16" />
        <SkeletonCard className="h-16" />
      </div>
      <SkeletonCard className="h-40" />
      <Skeleton className="h-5 w-20" />
      <SkeletonCard className="h-48" />
    </LoadingRegion>
  );
}
