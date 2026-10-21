import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

export const orders = pgTable("orders", {
  id: text("id").primaryKey(),
  productId: text("product_id").notNull(),
  amount: integer("amount").notNull(), // in cents, e.g. 2000 = $20.00
  currency: text("currency").notNull(),
  status: text("status").notNull().default("pending"), // pending | paid | failed | expired | refunded
  stripeSessionId: text("stripe_session_id"),
  stripePaymentIntent: text("stripe_payment_intent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  paidAt: timestamp("paid_at"),
  refundedAt: timestamp("refunded_at"),
});

export const processedEvents = pgTable("processed_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  processedAt: timestamp("processed_at").notNull().defaultNow(),
});

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderStatus = "pending" | "paid" | "failed" | "expired" | "refunded";
