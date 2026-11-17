import { LoadingRegion, Skeleton, SkeletonTitle } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion className="gap-6">
      <SkeletonTitle />
      {[0, 1].map((i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-5 w-28" />
          <div className="flex gap-2">
            <Skeleton className="h-12 w-24" />
            <Skeleton className="h-12 w-24" />
            {i === 0 && <Skeleton className="h-12 w-24" />}
          </div>
        </div>
      ))}
      <Skeleton className="h-12 w-full" />
    </LoadingRegion>
  );
}
