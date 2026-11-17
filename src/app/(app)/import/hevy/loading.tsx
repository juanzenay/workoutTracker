import { LoadingRegion, Skeleton, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion className="gap-6">
      <SkeletonTitle />
      <Skeleton className="h-4 w-full" />
      <SkeletonCard className="h-32" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </LoadingRegion>
  );
}
