import { LoadingRegion, Skeleton, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion className="gap-6">
      <div className="flex items-center justify-between gap-2">
        <SkeletonTitle />
        <Skeleton className="h-12 w-24" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-20" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonCard key={i} className="h-24" />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-20" />
        <SkeletonCard className="h-48" />
      </div>
    </LoadingRegion>
  );
}
