import { LoadingRegion, Skeleton, SkeletonList, SkeletonTitle } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion>
      <div className="flex items-center justify-between gap-2">
        <SkeletonTitle />
        <Skeleton className="h-12 w-28" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-12 w-full" />
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
      <Skeleton className="h-4 w-24" />
      <SkeletonList rows={8} />
    </LoadingRegion>
  );
}
