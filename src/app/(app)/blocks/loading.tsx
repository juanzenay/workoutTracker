import { LoadingRegion, Skeleton, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion>
      <div className="flex items-center justify-between gap-2">
        <SkeletonTitle />
        <Skeleton className="h-touch w-24" />
      </div>
      <div className="flex flex-col gap-2">
        <SkeletonCard className="h-16" />
        <SkeletonCard className="h-16" />
        <SkeletonCard className="h-16" />
      </div>
    </LoadingRegion>
  );
}
