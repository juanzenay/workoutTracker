"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Two-tap confirmation for destructive actions: `arm()` on the first tap, act on the second
 * while `armed`. Disarms itself after a few seconds.
 */
export function useArmed(timeoutMs = 4000): [armed: boolean, arm: () => void] {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), timeoutMs);
    return () => clearTimeout(timer);
  }, [armed, timeoutMs]);
  return [armed, useCallback(() => setArmed(true), [])];
}
