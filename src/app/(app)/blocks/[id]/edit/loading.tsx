import { LoadingRegion, Skeleton, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion>
      <SkeletonTitle />
      <Skeleton className="h-touch w-full" />
      <SkeletonCard className="h-32" />
      <SkeletonCard className="h-32" />
      <Skeleton className="h-touch-lg w-full" />
    </LoadingRegion>
  );
}
