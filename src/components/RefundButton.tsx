"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RefundButton({ orderId }: { orderId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleRefund() {
    if (!confirm("Request a full refund for this order?")) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Refund request failed");
      }
      // Start polling — the webhook will update the status to 'refunded'
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div className="mt-4">
      <button
        onClick={handleRefund}
        disabled={loading}
        className="w-full rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Requesting refund..." : "Request refund"}
      </button>
      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
