import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, sql } from "drizzle-orm";
import { orders, processedEvents } from "./schema";
import type { Order, OrderStatus } from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set in .env.local");
}

const client = neon(process.env.DATABASE_URL);

export const db = drizzle(client);

// ── Order helpers ────────────────────────────────────────────────────────────

export async function createOrder(o: {
  id: string;
  productId: string;
  amount: number;
  currency: string;
}) {
  await db.insert(orders).values({
    id: o.id,
    productId: o.productId,
    amount: o.amount,
    currency: o.currency,
    status: "pending",
  });
}

export async function attachSession(orderId: string, sessionId: string) {
  await db
    .update(orders)
    .set({ stripeSessionId: sessionId })
    .where(eq(orders.id, orderId));
}

export async function getOrder(id: string): Promise<Order | undefined> {
  const result = await db
    .select()
    .from(orders)
    .where(eq(orders.id, id))
    .limit(1);
  return result[0];
}

export async function getOrderByPaymentIntent(
  paymentIntent: string
): Promise<Order | undefined> {
  const result = await db
    .select()
    .from(orders)
    .where(eq(orders.stripePaymentIntent, paymentIntent))
    .limit(1);
  return result[0];
}

export async function markPaid(orderId: string, paymentIntent: string | null) {
  // Only update if still pending — never overwrite a final status
  await db
    .update(orders)
    .set({
      status: "paid",
      paidAt: sql`now()`,
      stripePaymentIntent: paymentIntent,
    })
    .where(eq(orders.id, orderId));
}

export async function markStatus(
  orderId: string,
  status: Extract<OrderStatus, "failed" | "expired">
) {
  await db
    .update(orders)
    .set({ status })
    .where(eq(orders.id, orderId));
}

export async function markRefunded(orderId: string) {
  await db
    .update(orders)
    .set({ status: "refunded", refundedAt: sql`now()` })
    .where(eq(orders.id, orderId));
}

// ── Idempotency helpers ──────────────────────────────────────────────────────

export async function hasProcessedEvent(eventId: string): Promise<boolean> {
  const result = await db
    .select({ id: processedEvents.id })
    .from(processedEvents)
    .where(eq(processedEvents.id, eventId))
    .limit(1);
  return result.length > 0;
}

export async function recordEvent(eventId: string, type: string) {
  await db
    .insert(processedEvents)
    .values({ id: eventId, type })
    .onConflictDoNothing();
}

export type { Order, OrderStatus };
