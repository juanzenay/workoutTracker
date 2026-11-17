import { LoadingRegion, Skeleton, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

/** History: title with the archive link, then workout cards. */
export default function Loading() {
  return (
    <LoadingRegion>
      <div className="flex items-baseline justify-between gap-4">
        <SkeletonTitle className="w-1/3" />
        <Skeleton className="h-5 w-20" />
      </div>
      {Array.from({ length: 4 }, (_, i) => (
        <SkeletonCard key={i} className="h-40" />
      ))}
    </LoadingRegion>
  );
}
