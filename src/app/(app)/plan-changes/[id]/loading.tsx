import { LoadingRegion, Skeleton, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion>
      <SkeletonTitle />
      <SkeletonCard className="h-48" />
      <Skeleton className="h-touch w-24" />
    </LoadingRegion>
  );
}
