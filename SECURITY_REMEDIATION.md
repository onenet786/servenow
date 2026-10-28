# Security, QA and Finance Remediation — 28 Oct 2026

This document covers the fixes made after the Security, QA and Chartered Accountant reviews:
- what changed
- what behaves differently
- what you must do before and after deploying
- what is still open

**Backup taken before any change:** tag `backup-pre-fixes-2026-10-28`, branch `backup/pre-fixes-2026-10-28`, and full copies in `D:\GIT-HUB\ServeNow_Backups\`. These are:
- a git bundle of all refs
- a source zip
- the untracked mobile files

To roll back everything: `git checkout backup-pre-fixes-2026-10-28`.

| Commit | Scope |
|---|---|
| `361d493` | Phase 1: security |
| `d369acf` | Phase 2: order, wallet and refund integrity |
| `bc6a295` | Phase 3: financial controls |
| `ea263b0` | Phase 4: QA hygiene, tests, CI, this document |
| Phase 5 commit | General ledger rebuild (§5) |

Run the automated checks with `npm test` (38 tests) and `npm run check` (syntax). CI runs both on every push. It also fails if a database dump, `.env`, keystore or key file is committed.

---

## 1. Do these yourself (cannot be done in code)

Do them in this order:

1. **Rotate every secret that was ever in git.**
   - **JWT secret:** generate a new one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. The server now refuses to start with the leaked one, so this rotation is required.
   - **Database password.**
   - **Passwords** of `admin@servenow.com`, `owner@servenow.pk` and any account using `123456`.
2. **Firewall port 3002.** Only the reverse proxy (Apache/Nginx) should reach Node. Serve the site over HTTPS only.
3. **Restrict the Firebase Android API key** in Google Cloud Console:
   - limit it to the app package and SHA-1
   - limit it to the APIs the app needs
   - enable App Check
4. **Check for unauthorised elevated accounts.** Public sign-up accepted a role until this fix. Run the query below and review every account:
   ```sql
   SELECT id, email, user_type, created_at FROM users
   WHERE user_type IN ('admin','store_owner','standard_user') ORDER BY created_at;
   ```
5. **Personal-data breach assessment.** 97 database dumps were in git history, containing names, phones, addresses, password hashes and reset tokens. Ask your legal adviser whether notification is required, and force password resets.
6. **Purge history.** Do this *after* steps 1–5, and coordinate it, because everyone must re-clone:
   ```bash
   pip install git-filter-repo
   git clone --mirror <repo-url> servenow-mirror && cd servenow-mirror
   git filter-repo --invert-paths \
     --path-glob 'database/backups/*.sql' --path .env \
     --path brute_check.js --path trigger_remote_assignment.js --path check_owner_remote.js \
     --path trigger_assignment.js --path check_pass.js --path fix_data.js
   git push --force --mirror
   ```
   Then delete old clones and forks, and ask GitHub support to purge cached views if the repository was ever public.
7. **Before deploying, check stock levels.** Stock is now enforced and reduced on each order (see §2). List the available products that will become unorderable:
   ```sql
   SELECT id, name, stock_quantity FROM products WHERE is_available = 1 AND stock_quantity <= 0;
   ```
   Either restock them, or set `stock_quantity = NULL` for products whose stock you don't track.

## 2. Behaviour changes users will notice

| Who | What changes |
|---|---|
| Customers | Orders fail with "Only N available" or "out of stock" when stock is short. Wallet orders show as **paid** immediately. New and changed passwords need at least 8 characters. |
| Customers | Deleting an account anonymises personal data. Order and payment history is kept for the accounts. |
| Riders | Cannot place orders, top up, save cards or send transfers. Rider wallets track collected cash and earnings only. |
| Store owners | Can set their items to confirmed, preparing, ready or picked up, and can cancel only before pickup. Cannot set out-for-delivery or delivered. |
| Dispatch | Two people assigning the same order at once: the second gets "updated by someone else, refresh". A paid order's delivery fee can't be changed. |
| Admin/staff | Items on a **paid** order can't be changed. Cancel it (the customer is refunded automatically) and place a new one. |
| Admin/staff | Only an admin can mark a paid order unpaid, and never after delivery. Reopening delivered or cancelled orders is limited to admins on `PRIVILEGED_ADMIN_EMAILS` (any admin if that list is empty). A reopened refunded order must be paid again. |
| Finance | Documents follow a fixed status flow: Draft/Pending → Approved → Paid. Paid, received, rejected and cancelled documents are final. |
| Finance | Once a voucher, expense or settlement is approved, its amount and payee can't be edited. Correct it with a journal voucher. |
| Finance | Staff cannot approve or pay a document they prepared, or post their own journal voucher. Set `FINANCE_STRICT_MAKER_CHECKER=true` to apply this to admins too. |
| Finance | Expenses must be approved before being paid. The person who approved a settlement cannot also pay it. |
| Finance | Journal vouchers must balance exactly (debits = credits). Direct ledger postings and manual settlements are admin-only. |
| Admin | The "clear transactional data" tool is off unless `ENABLE_DATA_RESET=true`. Stores with orders or settlements can only be deactivated, not deleted. |
| Admin | A delivery fee of 0 now really means free delivery. The financial reports endpoints need a report/finance permission. |

## 3. What was fixed

### Security
- **Registration:** it always creates customers. The admin-takeover path is closed.
- **Financial reports:** they deny by default. Guests, customers and riders are blocked.
- **Rider/customer ID collision:** fixed for order access, payment and delivery actions, socket rooms, wallets, permissions and account deletion.
- **Login tokens:** each request rechecks that the account is active and its role unchanged. A deactivated or demoted user loses access within 60 seconds.
- **Rate limits:** applied to email verification, resend-code and guest login.
- **Socket tokens:** no longer accepted in URLs.
- **Stored XSS:** user-entered fields are escaped in the admin, rider, store and customer pages, including inside inline handlers.
- **Uploads:** checked by file signature, saved with the detected extension, and `/uploads` serves images only. Rider ID images get random names.
- **Repository:** scripts with passwords removed, dumps untracked, and destructive scripts moved to `scripts/maintenance/destructive/` behind a confirmation guard. The server rejects leaked or placeholder JWT secrets. Verbose socket debug logging is off in production.

### Orders, wallet, payments
- **One transaction per order:** stock check, wallet debit, order, items, stock reduction and payment record are written together.
- **Retries:** order-number clashes are retried.
- **Double charges:** an already-paid order can't be paid again.
- **Cancellation refunds:** they now work. Previously they always failed on a wrong column name. They are atomic, happen once, and stock is restored only if it had been deducted.
- **Manual refund route:** admin-only, and pays the order's customer.
- **Stripe webhook:** it can now verify signatures.
- **Wallet balances:** updated relatively, so concurrent changes are never lost.
- **Schema checks:** they run once per process instead of on every request.

### Finance
- **Controls:** state machines, locked posted fields, maker-checker, balanced journal vouchers and single posting, all covered in §2.
- **Deletion:** cascading deletion of financial history is blocked.
- **Reports:** the base report totals include the last day of the period. Cancelled orders are excluded from the sales summaries.

## 4. Still open

These need a decision, a test database, or more work.

| Item | Why it is not done |
|---|---|
| **Ledger review items** (§5) | The general ledger is built and reconciled (§5). The items listed there need a decision from the accountant, not code. |
| **Card payments** (QA-18) | Checkout never charges a card. Either integrate Stripe Elements/PaymentIntents or hide the Card option. The checkout form also posts raw card fields if JavaScript fails, so remove them. |
| **`refunds` table missing** in production | The manual refund route can't work until it is created. Cancellation refunds do work. |
| **Business rules to confirm** | COD cash-in-hand limit (QA-22), rider availability at assignment, single-store-per-order rule (QA-23), store payable formula (keep the current per-store-type rule, centralised in the ledger work). |
| **Tax** (CA F-23) | Needs professional tax advice before implementation. |
| **Hardening** | Strict CSP (blocked by inline handlers), KYC images behind auth, `trust proxy` setting for your proxy chain, admin order-list pagination, rider day-close timezone, missing DB indexes, async notifications, accessibility pass. |

After the ledger rebuild, commission an authorised penetration test of a staging copy.

## 5. General ledger (double-entry)

Built and reconciled against a full copy of production taken 28 Oct 2026, restored to a local MariaDB 10.11 server. Production itself was not touched.

### How it works
- **Source of truth.** `services/ledger.js` posts a balanced journal for every business document:
  - delivered orders
  - rider wallet entries
  - rider cash movements
  - store settlements
  - payment and receipt vouchers
  - expenses
  - journal vouchers
  - card payments
  - manual ledger entries
- **Policies:**
  - Revenue is recognised **on delivery**.
  - Commission = item value − store payable. Store payables keep the per-store-type rule (pickup-paid stores are owed cost price; credit stores are owed price less discount).
  - Delivery fees are income.
  - Wallet top-ups and card prepayments are **liabilities**, not income.
- **Immutability.** Journals are never edited or deleted. When a document changes (for example a delivered order is cancelled), the sync posts a reversal dated today, then the corrected journal.
- **Balancing.** A journal that does not balance to the paisa is not posted; it is reported instead.
- **Sync.** Runs 15 seconds after start-up, every 10 minutes, and before every ledger report. On production data a full sync takes about 1 second.
- **Reports** (Reports → General Ledger, permission `menu_financial_dashboard`): trial balance, profit & loss, balance sheet, account statements per rider/store/order, and a reconciliation.
- **Financial Dashboard.** Income, expenses, net profit and cash in hand now come from the ledger. The old figures are still returned as `stats.legacy`.
- **Old transaction log.** No longer treats wallet top-ups or card prepayments as income, and its duplicate check no longer drops an order's second entry.

### Deploying
1. Take a database backup.
2. Deploy. On first start the server creates `gl_accounts`, `gl_journals` and `gl_lines`, and posts the full history (about 17,000 journals). To do this before going live instead, run `node scripts/ledger/rebuild-gl.js`; it is safe to repeat.
3. Open Reports → General Ledger → Trial Balance and confirm it says **Balanced**.

### Results on the 28 Oct data (6,612 delivered orders)

| | Old dashboard | General ledger |
|---|---|---|
| Income | 1,668,076 (mostly rider cash handed in) | 984,151 (commission 287,529, delivery fees 687,477, adjustments 9,145) |
| Expenses | 1,157,409 | 628,664 |
| Net profit | **−983,005** | **+355,487** |
| Cash in hand | −983,005 | −553,452 |

The trial balance and balance sheet both balance.

### For the accountant to review
1. **Office cash is −553,452.** More cash was paid out (vouchers 1.06M, settlements 1.15M) than riders submitted (1.66M). Four cash submissions totalling **1,760,405** have been *pending* since 17 Sep and 10 Oct (riders 3, 7 and 12). Confirm whether that cash was received. If so, approve them, and both office cash and rider balances become correct.
2. **Rider balances** (cash held): rider 3 414,446, rider 7 273,549, rider 12 216,623, rider 13 97,474, rider 14 11,839, rider 10 −74,747. Wallet differences are fully explained:
   - pending adjustments that were credited to wallets before approval: riders 3, 7 and 10
   - two submissions for rider 7 that were credited instead of debited: 2 × 2,550
   - stored balance drift: rider 3 +460, rider 12 −1,040
3. **CPV-40, "Historical Cash Store Purchase Adjustment", 436,030.** Posted as an unallocated payment to stores. It matches the 449,428 of cash-store purchases from before 19 May that have no pickup payment recorded. Confirm it was paid from office cash and not by riders from collections; if riders paid, reverse it against rider receivable with a journal voucher.
4. **120 orders were deleted** while their rider cash collections (74,179) remain. That revenue is missing; restore the orders from a backup if possible.
5. **Collections that don't match their order total:**
   - 64 orders differ from their total: −14,644
   - 7 collections recorded twice: −6,850
   - 2 collections on cancelled orders: −2,505
   - 9 delivered orders have no items (770)
6. **12 card orders (9,770)** were delivered and marked paid with no payment captured. Checkout never charges cards (QA-18).
7. **Suspense (34,101):**
   - 2 manual "reconciliation" plugs from March: 10,092 and −4,950
   - pickup payments to stores that no longer exist ("Adnan Restaurant", "Multani Naan Channa Shop", "Halwa Puri By Faisalabad Bakery"): allocate them with journal vouchers
8. **Credit stores overpaid by 25,664 in total.** Some settlements have a net amount above their order total (for example Murshid Da Dera −37,017).
9. **Rider fuel history** (`riders_fuel_history`) is a log, not a payment, so it is not posted. Fuel paid through vouchers is posted.

Receipt vouchers are fixed: "Approve" now marks a voucher received, and the person who prepared it cannot confirm it.
