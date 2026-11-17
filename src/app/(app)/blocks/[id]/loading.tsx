import { LoadingRegion, Skeleton, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion>
      <div className="flex flex-col gap-2">
        <SkeletonTitle />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <Skeleton className="h-5 w-24" />
      <SkeletonCard className="h-28" />
      <SkeletonCard className="h-28" />
      <Skeleton className="h-5 w-24" />
      <SkeletonCard className="h-28" />
    </LoadingRegion>
  );
}
