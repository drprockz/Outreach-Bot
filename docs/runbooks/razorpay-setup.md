# Razorpay Setup Runbook

One-time setup before any customer can subscribe. Without this, `POST /api/billing/create-subscription` returns a 400 from Razorpay because the plan IDs don't exist.

## 1. Account activation

1. Sign up at <https://dashboard.razorpay.com> with your business email
2. Submit KYC: PAN, GST (if applicable), bank account, sole-proprietorship docs
3. Wait 24–48 hours for activation (test mode is available immediately)

## 2. Create the 4 plans in Razorpay dashboard

Navigate to **Subscriptions → Plans → Create plan**. Create each of these with **exactly** the IDs below — the code in `apps/api/src/routes/billing.ts` looks them up by lowercase plan name.

| Plan ID (auto-generated, copy it) | Internal name to set | Billing cycle | Amount (paise) | Period |
|---|---|---|---|---|
| `plan_xxxxx` | `Starter` | Monthly | `299900` (= ₹2,999) | 1 month |
| `plan_xxxxx` | `Growth` | Monthly | `699900` (= ₹6,999) | 1 month |
| `plan_xxxxx` | `Agency` | Monthly | `1499900` (= ₹14,999) | 1 month |

**Important:** Razorpay generates its own `plan_id` (a random string starting with `plan_`). You CANNOT name them `plan_starter` etc. directly. Update `apps/api/src/routes/billing.ts` to use the actual IDs Razorpay assigns:

```typescript
const RAZORPAY_PLAN_IDS: Record<string, string> = {
  Starter: 'plan_QtHGXXXXXXXXXX', // paste from dashboard
  Growth:  'plan_QtHHGYYYYYYYY', // paste from dashboard
  Agency:  'plan_QtHIZZZZZZZZ', // paste from dashboard
}
```

(There's no Trial plan in Razorpay — trials are handled by Radar's own `OrgSubscription.status='trial'` for 14 days, no card collected.)

## 3. Webhook configuration

Navigate to **Settings → Webhooks → Add a new webhook**.

- **Webhook URL:** `https://radar.simpleinc.cloud/api/billing/webhook`
- **Secret:** generate one with `openssl rand -hex 32`, paste both into the Razorpay form AND your `.env` as `RAZORPAY_WEBHOOK_SECRET`
- **Events to subscribe:**
  - `subscription.activated`
  - `subscription.charged`
  - `subscription.cancelled`
  - `subscription.completed`
  - `payment.failed`

## 4. API keys

Navigate to **Settings → API Keys → Generate Test Key** (and later, Live Key after KYC).

Copy into `.env`:
```
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxx
RAZORPAY_WEBHOOK_SECRET=<the secret you generated above>
```

## 5. Test the webhook signature path

Razorpay's dashboard has a "Test Webhook" button that sends a `payment.failed` synthetic event. After clicking it:

```bash
psql $DATABASE_URL -c "SELECT * FROM razorpay_webhook_events ORDER BY processed_at DESC LIMIT 1"
```

You should see one row. If you see nothing, the signature verification is failing — check that the `RAZORPAY_WEBHOOK_SECRET` you set in dashboard matches the one in `.env` exactly.

## 6. Verify a real checkout end-to-end (test mode)

1. Log into your Radar dashboard as the org owner
2. Navigate to **Settings → Billing**, click **Upgrade to Starter**
3. The frontend calls `/api/billing/create-subscription` which returns a checkout URL
4. Open that URL — Razorpay test page renders
5. Use a test card: `4111 1111 1111 1111`, any future expiry, any CVV
6. Razorpay redirects back, fires `subscription.activated` webhook
7. `psql $DATABASE_URL -c "SELECT status FROM org_subscriptions WHERE org_id=1"` → should be `active`

## 7. Going live

Once your KYC is approved:

1. In Razorpay dashboard, switch the toggle from **Test Mode** to **Live Mode**
2. Generate live API keys, update `.env`:
   ```
   RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxxxxxx
   RAZORPAY_KEY_SECRET=<live secret>
   ```
3. Recreate the 3 plans in live mode (test plans don't carry over). Update plan IDs in `billing.ts`.
4. Re-add the webhook in live mode with the SAME `RAZORPAY_WEBHOOK_SECRET`.
5. `pm2 restart radar-api-v2`.

## Common gotchas

- **`Razorpay returned 400 BAD_REQUEST_ERROR`** when creating a subscription → the plan ID is wrong. Razorpay plan IDs are case-sensitive and must exist in the same mode (test vs live) as your API keys.
- **Webhook signature fails** → JSON whitespace mismatch. The webhook handler reads `req.rawBody` (set by Express's `express.json({ verify })` only for `/api/billing/webhook` paths). Don't strip body parsing for that route.
- **Customer in trial wants to subscribe** → the `OrgSubscription` already exists with `status='trial'` and no `razorpaySubId`. `create-subscription` updates the same row in place; it doesn't create a new one.
- **Customer cancels then re-subscribes** → `cancel` only sets `cancelAtPeriodEnd=true`. Until period actually ends, status stays `active`. To re-subscribe before period ends, call `change-plan` (it clears the cancel flag implicitly — verify by re-running the flow).

## Cost reference

Razorpay charges 2% (domestic) + GST on each successful payment. For ₹2,999 Starter, that's ~₹71/transaction in fees. Build it into your gross margin assumptions.
