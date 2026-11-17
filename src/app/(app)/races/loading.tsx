import { LoadingRegion, Skeleton, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion className="gap-6">
      <div className="flex items-baseline justify-between gap-2">
        <SkeletonTitle />
        <Skeleton className="h-touch w-24" />
      </div>
      <div className="flex flex-col gap-2">
        <SkeletonCard className="h-20" />
        <SkeletonCard className="h-14" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-7 w-1/3" />
        <SkeletonCard className="h-16" />
        <SkeletonCard className="h-16" />
        <SkeletonCard className="h-32" />
      </div>
    </LoadingRegion>
  );
}
