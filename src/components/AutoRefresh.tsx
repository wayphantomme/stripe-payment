"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Polls every `intervalMs` while the order status is still pending.
// Pass `active={false}` to stop polling once the status is final.
export default function AutoRefresh({
  active = true,
  intervalMs = 2000,
}: {
  active?: boolean;
  intervalMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, router]);

  return null;
}
