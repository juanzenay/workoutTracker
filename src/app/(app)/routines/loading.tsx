import { LoadingRegion, Skeleton, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion className="gap-6">
      <div className="flex items-center justify-between gap-2">
        <SkeletonTitle />
        <Skeleton className="h-touch w-24" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-1/3" />
        <SkeletonCard className="h-28" />
        <SkeletonCard className="h-28" />
      </div>
      <Skeleton className="h-touch w-full" />
    </LoadingRegion>
  );
}
