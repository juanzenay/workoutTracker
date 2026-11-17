import { LoadingRegion, Skeleton, SkeletonCard } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion className="gap-2">
      <Skeleton className="h-touch w-full" />
      <SkeletonCard className="h-32" />
      <SkeletonCard className="h-32" />
      <Skeleton className="h-touch w-full" />
    </LoadingRegion>
  );
}
