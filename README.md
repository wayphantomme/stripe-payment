# Stripe Payment Gateway

A full-stack payment gateway built with Next.js, Stripe, Drizzle ORM, and Neon PostgreSQL. Built in sandbox mode as a learning project.

**Live demo:** https://stripe-wayphantomme.vercel.app

## What it does

- Product listing page with buy buttons
- Stripe Checkout integration (server-side session creation, price never from browser)
- Webhook handler with signature verification and idempotency
- Order tracking in PostgreSQL (pending → paid → refunded)
- Success page with real-time status polling via auto-refresh
- Refund flow confirmed via webhook

## Tech stack

- [Next.js 16](https://nextjs.org) — App Router, TypeScript
- [Stripe](https://stripe.com) — Checkout, webhooks, refunds
- [Drizzle ORM](https://orm.drizzle.team) — schema, migrations, queries
- [Neon](https://neon.tech) — serverless PostgreSQL
- [Tailwind CSS v4](https://tailwindcss.com)
- Deployed on [Vercel](https://vercel.com)

## Architecture

```
Landing Page → POST /api/checkout → Stripe Checkout
                                          ↓
                              /success?order=id ← redirect
                              /api/webhook ← Stripe events
                                    ↓
                              Neon PostgreSQL (orders table)
                                    ↑
                              /api/refund → stripe.refunds.create
```

## Key concepts demonstrated

**Webhook as source of truth** — the success page starts as "pending" and only flips to "paid" after the webhook arrives, not after the redirect. Stopping `stripe listen` keeps it stuck at "pending" — that's the point.

**Idempotency** — the `processed_events` table prevents the same event from being handled twice, even if Stripe delivers it more than once.

**Server-side pricing** — product prices live in `src/lib/products.ts` on the server. The browser only sends a `productId`. Stripe session is created with the server's price.

**Refund via webhook** — clicking "Request refund" calls `/api/refund` which creates a refund in Stripe. The order status updates to `refunded` only after the `charge.refunded` webhook arrives.

## Local development

### Prerequisites

- Node.js 18+
- [Stripe CLI](https://docs.stripe.com/stripe-cli)
- A [Neon](https://neon.tech) PostgreSQL database
- A [Stripe](https://dashboard.stripe.com) account (test mode)

### Setup

```bash
git clone https://github.com/wayphantomme/stripe-payment.git
cd stripe-payment
npm install
```

Copy `.env.example` to `.env.local` and fill in the values:

```bash
cp .env.example .env.local
```

Run database migrations:

```bash
npx drizzle-kit migrate
```

### Running

Terminal 1 — dev server:
```bash
npm run dev
```

Terminal 2 — forward webhooks:
```bash
stripe listen --forward-to localhost:3000/api/webhook
```

Copy the `whsec_...` value from terminal 2 into `STRIPE_WEBHOOK_SECRET` in `.env.local`, then open http://localhost:3000.

### Test cards

| Scenario | Card number |
|---|---|
| Success | `4242 4242 4242 4242` |
| Decline | `4000 0000 0000 0002` |
| Insufficient funds | `4000 0000 0000 9995` |
| 3D Secure | `4000 0000 0000 3220` |

Use any future expiry date and any 3-digit CVC.

## Environment variables

| Variable | Description |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret (`whsec_...`) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (`pk_test_...`) |
| `DATABASE_URL` | Neon pooled connection string |
| `DATABASE_URL_UNPOOLED` | Neon direct connection string (migrations only) |
| `NEXT_PUBLIC_BASE_URL` | App base URL (`http://localhost:3000` or production URL) |
