import { LoadingRegion, Skeleton, SkeletonTitle } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion>
      <Skeleton className="h-12 w-24 bg-transparent" />
      <SkeletonTitle />
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
      <Skeleton className="h-12 w-full" />
    </LoadingRegion>
  );
}
