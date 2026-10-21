# Learn Stripe with Next.js: From Checkout to Webhooks

This guide walks you through building a complete payment flow in Stripe's **sandbox/test mode**. No business registration is required and no real money moves.

**What you'll build:**

1. A product page with a "Pay" button
2. A Route Handler that creates a **Checkout Session** (price decided by the server, not the browser)
3. A **webhook** that verifies the signature and marks the order as paid
4. Order storage in SQLite, including protection against duplicate events
5. A success page that shows why *a redirect does not mean the payment is confirmed*

---

## 0. Concept map (read once, come back when confused)

| Term | Meaning |
|---|---|
| **Sandbox / test mode** | The practice environment. API keys start with `sk_test_` and `pk_test_`. No funds move. |
| **Checkout Session** | One session on Stripe's hosted payment page. You create it via the API, then send the customer to `session.url`. |
| **PaymentIntent** | The object that tracks a single payment from start to finish. Checkout creates one for you behind the scenes. |
| **Webhook / event** | A message from Stripe to your server ("payment X succeeded"). This is the source of truth for payment status. |
| **Idempotency key** | A unique key so a repeated request doesn't create duplicate objects. |
| **Metadata** | Free-form data you attach to Stripe objects, such as your own order ID. |

**Golden rule:** never assume a payment succeeded just because the customer landed on your `/success` page. They can close the tab, the connection can drop, and some payment methods only settle minutes or days later. The only thing you can trust is a **webhook event whose signature you have verified**.

---

## 1. Setup

### 1.1 Account and keys

1. Sign up at <https://dashboard.stripe.com/register> with just an email.
2. Make sure you are in **sandbox/test mode** (check the account switcher in the Dashboard).
3. Open **Developers → API keys** and note:
   - `Secret key` (`sk_test_...`), server-side only
   - `Publishable key` (`pk_test_...`), safe for the browser (not used in this project because we use hosted Checkout)

> ⚠️ **Keep your secret key private.** Don't commit it to Git, paste it into chats or forums, or send it to the browser. If it's ever exposed (for example, copied along with a docs page that displays your account's keys), go to the Dashboard and **roll/regenerate** it. Test keys can't move real money, but build the good habit now.

### 1.2 Stripe CLI

The Stripe CLI forwards webhooks to your computer and triggers test events. Follow the official instructions for your OS at <https://docs.stripe.com/cli/install>, then:

```bash
stripe login
```

### 1.3 Next.js project

```bash
npx create-next-app@latest stripe-learn --ts --app --no-tailwind --no-src-dir --eslint --import-alias "@/*"
cd stripe-learn
npm install stripe better-sqlite3
npm install -D @types/better-sqlite3
```

> If your version of `create-next-app` rejects those flags, run it without flags and answer the prompts: TypeScript **Yes**, App Router **Yes**, `src/` directory **No**. This guide uses the structure without `src/`.

### 1.4 Environment variables

Create `.env.local` in the project root:

```bash
STRIPE_SECRET_KEY=sk_test_FILL_FROM_DASHBOARD
STRIPE_WEBHOOK_SECRET=whsec_FILL_LATER_FROM_STRIPE_LISTEN
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

Make sure `.env*.local` is in `.gitignore` (Next.js normally includes it by default).

---

## 2. File structure

```
stripe-learn/
├─ .env.local
├─ next.config.ts
├─ lib/
│  ├─ stripe.ts
│  ├─ db.ts
│  └─ products.ts
├─ components/
│  ├─ BuyButton.tsx
│  └─ AutoRefresh.tsx
└─ app/
   ├─ page.tsx
   ├─ success/page.tsx
   ├─ cancel/page.tsx
   └─ api/
      ├─ checkout/route.ts
      └─ webhook/route.ts
```

---

## 3. The code

### 3.1 `next.config.ts`

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
```

### 3.2 `lib/stripe.ts`

```ts
import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY is not set in .env.local");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
```

### 3.3 `lib/products.ts`

The catalog lives on the **server**. The browser only sends a `productId`; prices are never taken from the browser because they could be tampered with.

```ts
export type Product = {
  id: string;
  name: string;
  description: string;
  amount: number; // smallest currency unit. USD: cents (2000 = $20.00)
  currency: string;
};

export const PRODUCTS: Record<string, Product> = {
  "nextjs-ebook": {
    id: "nextjs-ebook",
    name: "Learn Next.js E-book",
    description: "A sample product for payment practice",
    amount: 2000,
    currency: "usd",
  },
  "stripe-course": {
    id: "stripe-course",
    name: "Stripe Basics Course",
    description: "A second sample product",
    amount: 4900,
    currency: "usd",
  },
};

export function getProduct(id: string): Product | null {
  return PRODUCTS[id] ?? null;
}
```

### 3.4 `lib/db.ts`

SQLite is plenty for learning. There are two tables: `orders` and `processed_events` (to prevent the same event from being processed twice).

```ts
import Database from "better-sqlite3";

const globalForDb = globalThis as unknown as { db?: Database.Database };

export const db =
  globalForDb.db ??
  (() => {
    const instance = new Database("data.db");
    instance.pragma("journal_mode = WAL");
    instance.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        stripe_session_id TEXT,
        stripe_payment_intent TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        paid_at TEXT
      );
      CREATE TABLE IF NOT EXISTS processed_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        processed_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    return instance;
  })();

if (process.env.NODE_ENV !== "production") globalForDb.db = db;

export type OrderStatus = "pending" | "paid" | "failed" | "expired";

export type Order = {
  id: string;
  product_id: string;
  amount: number;
  currency: string;
  status: OrderStatus;
  stripe_session_id: string | null;
  stripe_payment_intent: string | null;
  created_at: string;
  paid_at: string | null;
};

export function createOrder(o: {
  id: string;
  productId: string;
  amount: number;
  currency: string;
}) {
  db.prepare(
    `INSERT INTO orders (id, product_id, amount, currency) VALUES (?, ?, ?, ?)`
  ).run(o.id, o.productId, o.amount, o.currency);
}

export function attachSession(orderId: string, sessionId: string) {
  db.prepare(`UPDATE orders SET stripe_session_id = ? WHERE id = ?`).run(
    sessionId,
    orderId
  );
}

export function getOrder(id: string): Order | undefined {
  return db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id) as
    | Order
    | undefined;
}

export function markPaid(orderId: string, paymentIntent: string | null) {
  // Only change from 'pending' so we never overwrite a final status
  db.prepare(
    `UPDATE orders
       SET status = 'paid', paid_at = datetime('now'), stripe_payment_intent = ?
     WHERE id = ? AND status = 'pending'`
  ).run(paymentIntent, orderId);
}

export function markStatus(orderId: string, status: "failed" | "expired") {
  db.prepare(
    `UPDATE orders SET status = ? WHERE id = ? AND status = 'pending'`
  ).run(status, orderId);
}

export function hasProcessedEvent(eventId: string): boolean {
  return !!db
    .prepare(`SELECT 1 FROM processed_events WHERE id = ?`)
    .get(eventId);
}

export function recordEvent(eventId: string, type: string) {
  db.prepare(
    `INSERT OR IGNORE INTO processed_events (id, type) VALUES (?, ?)`
  ).run(eventId, type);
}
```

### 3.5 `app/api/checkout/route.ts`

```ts
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { stripe } from "@/lib/stripe";
import { getProduct } from "@/lib/products";
import { createOrder, attachSession } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { productId } = (await req.json().catch(() => ({}))) as {
    productId?: string;
  };

  const product = productId ? getProduct(productId) : null;
  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 400 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL!;
  const orderId = randomUUID();

  // 1) Record the order first with status 'pending'
  createOrder({
    id: orderId,
    productId: product.id,
    amount: product.amount,
    currency: product.currency,
  });

  // 2) Create the Checkout Session. orderId goes in metadata + client_reference_id
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: product.currency,
            unit_amount: product.amount,
            product_data: {
              name: product.name,
              description: product.description,
            },
          },
        },
      ],
      client_reference_id: orderId,
      metadata: { orderId },
      // Also attach metadata to the PaymentIntent so it's easy to trace in the Dashboard
      payment_intent_data: { metadata: { orderId } },
      success_url: `${baseUrl}/success?order=${orderId}`,
      cancel_url: `${baseUrl}/cancel?order=${orderId}`,
    },
    // Idempotency: the same request never creates two sessions
    { idempotencyKey: `checkout-${orderId}` }
  );

  attachSession(orderId, session.id);

  return NextResponse.json({ url: session.url });
}
```

### 3.6 `app/api/webhook/route.ts`

The most important part. Two things matter here:

- Read the **raw** body with `req.text()`. If you parse it as JSON first, signature verification will fail.
- Be **idempotent**: Stripe may deliver the same event more than once.

```ts
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import {
  db,
  hasProcessedEvent,
  recordEvent,
  markPaid,
  markStatus,
} from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  // Raw body: do not parse before verifying
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error("Invalid webhook signature:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Already processed? Reply 200 so Stripe stops retrying
  if (hasProcessedEvent(event.id)) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    // Transaction: processing and recording the event succeed or fail together
    db.transaction(() => {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          const orderId = session.metadata?.orderId;
          // For async payment methods, 'completed' can arrive before the funds do.
          // Only treat it as paid when payment_status === 'paid'.
          if (orderId && session.payment_status === "paid") {
            markPaid(orderId, (session.payment_intent as string) ?? null);
            // TODO: send email, grant access, reduce stock, etc.
          }
          break;
        }
        case "checkout.session.async_payment_succeeded": {
          const session = event.data.object as Stripe.Checkout.Session;
          const orderId = session.metadata?.orderId;
          if (orderId) markPaid(orderId, (session.payment_intent as string) ?? null);
          break;
        }
        case "checkout.session.async_payment_failed": {
          const session = event.data.object as Stripe.Checkout.Session;
          const orderId = session.metadata?.orderId;
          if (orderId) markStatus(orderId, "failed");
          break;
        }
        case "checkout.session.expired": {
          const session = event.data.object as Stripe.Checkout.Session;
          const orderId = session.metadata?.orderId;
          if (orderId) markStatus(orderId, "expired");
          break;
        }
        default:
          // Other events are intentionally ignored
          break;
      }
      recordEvent(event.id, event.type);
    })();
  } catch (err) {
    console.error("Failed to process event", event.id, err);
    // A 500 makes Stripe retry later
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
```

### 3.7 `components/BuyButton.tsx`

```tsx
"use client";

import { useState } from "react";

export default function BuyButton({ productId }: { productId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error ?? "Could not create session");
      window.location.href = data.url; // go to Stripe's payment page
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div>
      <button onClick={handleClick} disabled={loading}>
        {loading ? "Processing..." : "Pay"}
      </button>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </div>
  );
}
```

### 3.8 `components/AutoRefresh.tsx`

Re-fetches server data every few seconds while the order isn't final. This is what makes it visible why we wait for the webhook.

```tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AutoRefresh({ intervalMs = 2000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
```

### 3.9 `app/page.tsx`

```tsx
import BuyButton from "@/components/BuyButton";
import { PRODUCTS } from "@/lib/products";

export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: "40px auto", padding: 16 }}>
      <h1>Stripe Practice Shop</h1>
      <p>Test mode. Use the test card <code>4242 4242 4242 4242</code>.</p>
      {Object.values(PRODUCTS).map((p) => (
        <section
          key={p.id}
          style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, marginTop: 16 }}
        >
          <h2>{p.name}</h2>
          <p>{p.description}</p>
          <p>
            <strong>
              {(p.amount / 100).toLocaleString("en-US", {
                style: "currency",
                currency: p.currency.toUpperCase(),
              })}
            </strong>
          </p>
          <BuyButton productId={p.id} />
        </section>
      ))}
    </main>
  );
}
```

### 3.10 `app/success/page.tsx`

```tsx
import AutoRefresh from "@/components/AutoRefresh";
import { getOrder } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Success({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order: orderId } = await searchParams;
  const order = orderId ? getOrder(orderId) : undefined;

  if (!order) {
    return <main style={{ padding: 16 }}>Order not found.</main>;
  }

  return (
    <main style={{ maxWidth: 640, margin: "40px auto", padding: 16 }}>
      <h1>Order status</h1>
      <p>ID: <code>{order.id}</code></p>

      {order.status === "pending" && (
        <>
          <p>⏳ Waiting for payment confirmation from Stripe...</p>
          <p style={{ fontSize: 14, opacity: 0.7 }}>
            This page refreshes automatically. If it doesn't change, make sure{" "}
            <code>stripe listen</code> is running.
          </p>
          <AutoRefresh />
        </>
      )}
      {order.status === "paid" && <p>✅ Payment successful. Thank you!</p>}
      {order.status === "failed" && <p>❌ Payment failed. Please try again.</p>}
      {order.status === "expired" && <p>⌛ The payment session expired.</p>}
    </main>
  );
}
```

### 3.11 `app/cancel/page.tsx`

```tsx
import Link from "next/link";

export default function Cancel() {
  return (
    <main style={{ maxWidth: 640, margin: "40px auto", padding: 16 }}>
      <h1>Payment cancelled</h1>
      <p>You have not been charged.</p>
      <Link href="/">Back to the shop</Link>
    </main>
  );
}
```

---

## 4. Running and trying it

Open **two terminals**.

**Terminal 1: the app**

```bash
npm run dev
```

**Terminal 2: forward webhooks to your machine**

```bash
stripe listen --forward-to localhost:3000/api/webhook
```

The CLI prints something like `Your webhook signing secret is whsec_...`. Copy that value into `STRIPE_WEBHOOK_SECRET` in `.env.local`, then **restart `npm run dev`** so it's picked up.

**First test (happy path):**

1. Open <http://localhost:3000> and click **Pay** on a product.
2. On Stripe's page enter card `4242 4242 4242 4242`, any future expiry (for example `12/34`), any 3-digit CVC, and anything for the other fields.
3. You're redirected to `/success`. It first shows "waiting", then flips to "successful" once the webhook arrives.
4. In terminal 2 you'll see the `checkout.session.completed` event forwarded with a `200` response.

---

## 5. Test scenarios (required practice)

Use these numbers in the payment form for interactive testing. Full details: <https://docs.stripe.com/testing>.

| Scenario | Card number | What you learn |
|---|---|---|
| Success | `4242 4242 4242 4242` | The basic flow |
| Generic decline | `4000 0000 0000 0002` | The error message in Stripe's form |
| Insufficient funds | `4000 0000 0000 9995` | The `insufficient_funds` decline code |
| 3D Secure required | `4000 0000 0000 3220` | The extra authentication flow |
| Always authenticate | `4000 0027 6000 3184` | Testing 3DS on every transaction |
| Dispute (fraudulent) | `4000 0000 0000 0259` | How a dispute appears in the Dashboard |

**Extra exercises:**

- **Break webhook verification:** change `STRIPE_WEBHOOK_SECRET` slightly, pay, and watch the server answer `400`. Restore it afterwards.
- **Duplicate events:** in the Dashboard (Developers → Webhooks/Events) resend the same event, or run `stripe events resend <event_id>`. The order must not change twice, thanks to `processed_events`.
- **Webhook not running:** stop `stripe listen`, pay, and see the status stay "waiting". This is proof that a redirect alone isn't enough.
- **Manual trigger:**

  ```bash
  stripe trigger checkout.session.completed
  ```

  This synthetic event has no `orderId` from your database, so the handler ignores it. It's a good check that the handler doesn't crash on unexpected data.

> **Security note for test code:** typing test card numbers into the payment form is fine. But if you write automated tests that call the API, use `PaymentMethod` tokens such as `pm_card_visa` rather than raw card numbers in server-side code.

---

## 6. Checking results in the Dashboard

- **Payments**: the list of test payments and their statuses.
- **Developers → Events**: every event with its payload (very helpful for debugging).
- **Developers → Webhooks / Workbench**: webhook delivery logs and your server's responses.
- Also check `metadata.orderId` on a payment, which shows your order data is linked to the Stripe objects.

To inspect the local database:

```bash
npx --yes better-sqlite3-cli data.db "SELECT id, status, paid_at FROM orders;"
```

Or use any SQLite app that can open `data.db`.

---

## 7. Learning roadmap

Suggested order once the project above works:

1. **Refunds**: `stripe.refunds.create({ payment_intent })`, and handle the `refund.updated` event. Test with the async-refund cards on Stripe's testing page.
2. **Disputes**: the dispute test cards above; study the `charge.dispute.created` event and how to submit evidence.
3. **Payment Element** (a payment form inside your own site): start with PaymentIntent + `client_secret`. This teaches the PaymentIntent concept more deeply than hosted Checkout.
4. **Subscriptions** (Stripe Billing): recurring products and prices, plus the `invoice.paid` and `invoice.payment_failed` events.
5. **Customer Portal**: let customers manage their own subscriptions.
6. **Stripe Connect**: if you want to build a marketplace.
7. **Security and operations**: key rotation, restricted API keys, monitoring failed webhooks, logging that doesn't leak sensitive data.

Official references:

- Accept online payments: <https://docs.stripe.com/payments>
- Testing: <https://docs.stripe.com/testing>
- API reference: <https://docs.stripe.com/api>
- Stripe CLI: <https://docs.stripe.com/cli>
- Code samples: <https://github.com/stripe-samples>

---

## 8. Notes for developers in Indonesia

- **Learning in the sandbox needs no legal paperwork.** Legal requirements only matter when you activate a live account.
- According to the Stripe documentation I checked, Stripe accounts based in Indonesia are invite-only, support only bank transfer (virtual account) in IDR, and don't support cross-border transactions. Always check <https://stripe.com/global> and Stripe's help pages, as this can change.
- For a real product with local customers, once you understand Stripe, **compare it with Midtrans or Xendit** (they support QRIS, e-wallets, and virtual accounts). Almost everything you learn here (webhooks, idempotency, async payment states, signature verification) carries over.
- The code above uses USD because it's the easiest in the sandbox. The currencies and payment methods available on a live account depend on the country of your Stripe account.

---

## 9. Go-live checklist (for later)

- [ ] Live keys stored in a secret manager or the hosting platform's environment variables, not in the repo
- [ ] Production webhook endpoint registered in the Dashboard with a **separate** signing secret from the local one
- [ ] Webhook handler is idempotent and responds quickly (do heavy work asynchronously)
- [ ] Prices and quantities are always computed on the server
- [ ] Orders are fulfilled only after a verified paid event
- [ ] Refunds, disputes, and failed payments have been tried in the sandbox
- [ ] A production database is used (not local SQLite) if the app runs on multiple instances or serverless
- [ ] Logs contain no API keys, card data, or unnecessary personal data
- [ ] The Stripe account is activated and verified according to your country's requirements

---

## 10. Common problems

| Symptom | Common cause | Fix |
|---|---|---|
| `No signatures found matching the expected signature` | Body parsed before verification, or wrong secret | Use `await req.text()`; make sure the `whsec_` comes from the currently running `stripe listen`; restart the dev server after editing `.env.local` |
| Order status stays "waiting" | `stripe listen` isn't running, or the forward URL is wrong | Re-run `stripe listen --forward-to localhost:3000/api/webhook` |
| `STRIPE_SECRET_KEY is not set` | `.env.local` not loaded | Check the variable name and restart `npm run dev` |
| Error loading `better-sqlite3` | Native module not built for your Node version | Run `npm rebuild better-sqlite3` or use an LTS Node version |
| Webhook delivered twice | Normal; Stripe may redeliver | Already handled by the `processed_events` table |
| `429 Too Many Requests` in sandbox | Sandbox rate limits are stricter | Reduce request frequency; don't load-test in the sandbox |

Happy learning! If a section feels confusing, take one stage at a time: Checkout first, then the webhook, then order storage.