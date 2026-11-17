import { LoadingRegion, Skeleton, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

/** Today's skeleton, and the fallback for every signed-in page without its own `loading.tsx`. */
export default function Loading() {
  return (
    <LoadingRegion>
      <div className="flex items-baseline justify-between gap-2">
        <SkeletonTitle className="w-1/3" />
        <Skeleton className="h-5 w-24" />
      </div>
      <Skeleton className="min-h-touch-lg w-full" />
      <SkeletonCard className="h-20" />
      <SkeletonCard className="h-44" />
      <SkeletonCard className="h-[26rem]" />
      <SkeletonCard className="h-20" />
      <SkeletonCard className="h-32" />
      <SkeletonCard className="h-28" />
    </LoadingRegion>
  );
}
