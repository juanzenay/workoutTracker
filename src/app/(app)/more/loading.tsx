import { LoadingRegion, Skeleton, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion className="gap-6">
      <SkeletonTitle />
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-20" />
          <SkeletonCard className="h-28" />
        </div>
      ))}
      <Skeleton className="h-12 w-full" />
    </LoadingRegion>
  );
}
