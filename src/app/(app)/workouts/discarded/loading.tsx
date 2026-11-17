import { LoadingRegion, Skeleton, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

/** The archive: back link, title, then discarded workout cards with Restore. */
export default function Loading() {
  return (
    <LoadingRegion>
      <Skeleton className="my-3 h-4 w-20" />
      <SkeletonTitle />
      {Array.from({ length: 4 }, (_, i) => (
        <SkeletonCard key={i} className="h-32" />
      ))}
    </LoadingRegion>
  );
}
