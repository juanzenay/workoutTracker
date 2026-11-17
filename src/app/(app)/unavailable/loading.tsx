import { LoadingRegion, Skeleton, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion className="gap-6">
      <SkeletonTitle />
      <Skeleton className="h-5 w-full" />
      <SkeletonCard className="h-40" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-7 w-1/3" />
        <SkeletonCard className="h-16" />
        <SkeletonCard className="h-16" />
      </div>
    </LoadingRegion>
  );
}
