import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import {
  hasProcessedEvent,
  markPaid,
  markStatus,
  recordEvent,
} from "@/lib/db";

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error("STRIPE_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  // Read raw body BEFORE any parsing — signature verification will fail otherwise
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Idempotency check — Stripe may deliver the same event more than once
  const alreadyProcessed = await hasProcessedEvent(event.id);
  if (alreadyProcessed) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = session.metadata?.orderId;
        // For async payment methods, 'completed' can arrive before funds settle.
        // Only mark paid when payment_status === 'paid'.
        if (orderId && session.payment_status === "paid") {
          await markPaid(orderId, (session.payment_intent as string) ?? null);
        }
        break;
      }

      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = session.metadata?.orderId;
        if (orderId) {
          await markPaid(orderId, (session.payment_intent as string) ?? null);
        }
        break;
      }

      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = session.metadata?.orderId;
        if (orderId) {
          await markStatus(orderId, "failed");
        }
        break;
      }

      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = session.metadata?.orderId;
        if (orderId) {
          await markStatus(orderId, "expired");
        }
        break;
      }

      default:
        // Intentionally ignore other event types
        break;
    }

    // Record the event only after successful processing
    await recordEvent(event.id, event.type);
  } catch (err) {
    // Returning 500 tells Stripe to retry delivery later
    console.error("Failed to process webhook event", event.id, err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
