import { LoadingRegion, Skeleton, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion>
      <Skeleton className="h-12 w-24 bg-transparent" />
      <SkeletonTitle />
      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="aspect-[4/3] w-full" />
        <Skeleton className="aspect-[4/3] w-full" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
      </div>
      <Skeleton className="h-5 w-24" />
      <SkeletonCard className="h-32" />
      <SkeletonCard className="h-32" />
    </LoadingRegion>
  );
}
