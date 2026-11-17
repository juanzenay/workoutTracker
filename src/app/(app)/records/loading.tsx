import { LoadingRegion, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

/** Records: title, then one card of bests per exercise. */
export default function Loading() {
  return (
    <LoadingRegion>
      <SkeletonTitle />
      {Array.from({ length: 5 }, (_, i) => (
        <SkeletonCard key={i} className="h-28" />
      ))}
    </LoadingRegion>
  );
}
