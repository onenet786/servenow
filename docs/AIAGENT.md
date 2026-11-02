# AIAgent chat assistant

ServeNow can show the AIAgent chat (text and voice) on every web page except the sign-in pages, and
inside the mobile app (the ServeNow help screen). The assistant answers from live ServeNow data. It
changes something only through an **action** (below), and only after the person confirmed a summary.
It never moves money.

## What it can answer

| Tool | Who | What |
|---|---|---|
| `find_stores` | anyone | Stores matching a name, area or product; open now, hours, delivery time, store notice |
| `find_products` | anyone | Products by name across stores, with price, store and whether they can be ordered now |
| `store_products` | anyone | One store's menu ("what does Aghosh Hotel have"): products grouped by category with prices, hours and delivery time; narrows by category or name when long |
| `my_orders` | signed-in customers (also store owners and staff who order) | Their latest 5 orders |
| `order_status` | signed-in | One order in full. Customers see their own orders, riders the orders given to them, store owners their stores' orders, admins and staff with *View orders* all orders |
| `my_wallet` | customers, riders | Wallet balance and latest transactions |
| `rider_deliveries` | riders | Deliveries not finished yet |
| `my_attendance` | riders and staff on the HR staff list | Their **own** attendance: checked in today or not, times and breaks, and a month's present, absent (with dates), leave and weekly-off days with their salary worked out like the payroll screen. No HR right needed: it only ever shows the asker |
| `store_orders_today` | store owners | Today's orders for their stores |
| `business_today` | admins, staff with *View dashboard* | Today's live picture: orders by status, orders waiting for a rider, riders available, busiest stores, and how many customers, stores, riders and products there are |
| `admin_report` | admins, staff | Any of 46 admin panel reports for any day or period (below) |

Visitors who are not signed in can only use the first two. An unknown order number and somebody
else's order get the same "not found" answer. Branch accounts only hear about their own branch.

## Admin panel reports (`admin_report`)

Staff can ask about the business in chat or by voice on the website and in the app: "aaj ki cash aur credit sale",
"October ka profit", "Faizan ke paas kitna cash hai", "Imran Broast ka balance", "top products".

Each report is the panel's own route, called in-process as the person asking (`services/assistantReports.js`), so:

- The figures are the panel's. No report is calculated a second time.
- The route checks that person's rights. Staff without a right hear that it needs an administrator.
- A branch account passes the same guard as on the website and only gets its own branch. Head office gets all
  branches, or one branch when it is named.
- Only the routes listed in `PANEL_REPORTS`, plus every Reports Centre report, can be reached, and only with GET.
  Backups, diagnostics and changes are not listed. Nothing in the tool's arguments becomes part of a path.

Before an answer goes to the AI model, phone numbers, emails, addresses, CNIC, bank details and images are removed, so
the assistant cannot read those out. Customer names, sales and amounts are sent, because the answer needs them; they
pass through AIAgent and its AI provider. Long lists are cut to fit AIAgent's limits (a tool answers in 10 seconds and
up to 16,000 characters). Totals are never cut, and the assistant is told to say the list was shortened.

To add a report, add a line to `PANEL_REPORTS`, its name to the `report` list in `services/aiagent.js`, then press
**Refresh**. A new Reports Centre report is picked up by itself; add its name to that description.

### Attendance and payroll

Staff with the HR right ask "aaj kaun aaya hai?", "kaun bahar gaya hai?", "Ali kal aaya tha?", "Sana ki is mahine attendance",
"October ki payroll". `attendance_day`, `attendance_month` and `payroll` are the HR screens' own answers, tidied in
`services/assistantHr.js`:

- Times are **Pakistan time** ("9:05 AM"). The database driver gives instants that print as UTC; the HR page converts
  them in the browser, so the assistant gets them converted too.
- For today, each person's **now**: in, out for a reason (Bank Work, Lunch or Namaz, …) since when, or gone home, plus
  counts of who is in, out and gone home. Breaks (went out and came back) are listed.
- `employee` keeps **one person** by name (or asks which one when several match), within the asker's branch.
- A one-day report asked for a range ("pichle hafte") says which day it shows (`period_note`), and a month report
  says which month, instead of quietly answering for another period.

Riders and staff ask about themselves with `my_attendance`: "kya maine check in kiya?", "is mahine meri kitni
chuttiyan?", "kaun se din absent tha?", "meri salary kitni banegi?". The month uses the payroll screen's own
calculation (`monthFigures` in `routes/hr.js`); a month already paid shows the voucher's final figures.

## What it can do (actions)

| Action | Who | What |
|---|---|---|
| `place_order` | signed-in customers | "2 chicken biryani Aghosh Hotel se, aur 1 yogurt Shafiq Malik Center se": one order from one or several stores of the customer's city (delivery fee per number of stores, as on the website); finds the products and sizes (asks when unclear), keeps a note per item and for the order, uses the saved address unless another is given, cash on delivery or wallet. The summary reads every line by store with size, price, free offer items and notes, then delivery, total, payment and address, and asks "anything to add, remove or change?"; any change before "yes" gives a new summary from the full list. The order goes through the website's own order handler (`POST /api/orders`), first as a dry run for the summary, so prices, offers, stock, store hours, branch, delivery fee and wallet balance follow the website exactly |
| `edit_order` | signed-in customers, own orders | Changes the order directly while it is safe: still **pending** (the store has not accepted, no rider), **cash on delivery and unpaid**, within **10 minutes**, at most **3 edits**. The new list is priced by the order handler's dry run (same rules), then saved in one transaction with the order row locked: still pending? give back the old stock, check and take the new stock, replace the items, update totals and address; all or nothing. Kept in `order_edits` (old and new items and totals); stores and branch staff are told at once. Otherwise it hands over to `request_order_change` |
| `request_order_change` | signed-in customers, own orders | After ordering: "mere order mein 1 cold drink aur add kar do". Only before the rider picks it up (pending, confirmed, preparing, ready), at most 5 per order. Saved in `order_change_requests`, added to the order's note (store, dispatch and rider see it on the order), and announced live to the order's branch staff (bell and pop-up) and its store owners (notification and push). Staff apply it with the order edit screens. `order_status` shows the customer their requests |
| `assign_rider` | admins, staff with *Edit orders* (the right the admin screen's Assign rider needs) | "Assign Ali to order ORD-…": finds the rider by name among the order's branch riders; lists them if several or none match |

Answers about stores, products and orders carry their page links (`store.html?id=…`,
`order-confirmation.html?order_number=…`, `orders.html`) so the assistant can share them; set
`PUBLIC_SITE_URL` if the site is not `https://servenow.pk`.

How an action runs (utils/aiagent-connect.js):

1. The first call changes nothing. It checks everything the admin screen checks (order status, branch,
   rider active and in the same branch, cash or wallet records, a paid order's amount) and answers with a
   summary such as *"Give order ORD-11 (Fresh Mart, Rs 1,250, ready) to Ali Khan? He has 2 unfinished
   deliveries."* and a confirmation code.
2. The assistant reads it out. Only after a clear yes does it call again with the code.
3. The code fits only that person, that order and that rider, lasts 10 minutes and works once; a second
   yes does not assign twice. The rider, store owner and customer are notified as from the admin screen.
4. Each confirmed action is recorded in the `assistant_actions` table (who, what, result, when).

After adding or changing tools, press **Refresh** on ServeNow in AIAgent (Tools → Connected systems).

## Set up (once)

In the AIAgent dashboard:

1. **Channels → Website → Add.** Under **Allowed websites** list `https://servenow.pk` (and any other
   address customers use). Copy the channel key.
2. On that channel, open **Signed-in users** and click **Turn on and create secret**. Copy the secret
   (it is shown once). Leave *Only signed-in users may chat* off so visitors can ask about stores.
3. **Tools → Connected systems**, type `servenow.pk` and press **Connect**. AIAgent reads
   `https://servenow.pk/.well-known/aiagent.json`, creates the tools and shows one signing secret,
   once. Copy it.

On the ServeNow server, add to `.env` and restart:

```
AIAGENT_URL=https://<your AIAgent address>
AIAGENT_CHANNEL_KEY=<channel key from step 1>
AIAGENT_IDENTITY_SECRET=<secret from step 2>
AIAGENT_TOOL_SECRET=<secret from step 3>
```

Then press **Check** on the connected system in AIAgent. It should say *Connected*.

If AIAgent and ServeNow run on the same server, add `servenow.pk` to AIAgent's `TRUSTED_HOSTS`.

## How it works

- `GET /api/aiagent/widget` tells the page whether the assistant is on. For a signed-in person it also
  returns a JWT (HS256, the identity secret, valid 2 hours) and a per-account `scope`, so people who share a
  browser keep separate chats. Guests get no identity.
- The page loads AIAgent's `widget.js` with that token (`js/aiagent.js`). In `/next` the chat reloads on
  sign-in and sign-out.
- AIAgent calls `POST /integrations/aiagent/tools`. Each call is signed with the tool secret
  (`X-AIAgent-Signature`, HMAC-SHA256 of the raw body) and refused if `sent_at` is over 5 minutes old.
  The identity token is verified again here and the account reloaded: a switched-off account, or one whose
  role has changed, is treated as a visitor.
- The CSP allows the AIAgent address for scripts and audio, and the microphone for this site, only when
  `AIAGENT_URL` is set.

Remove the four variables (or empty `AIAGENT_URL`) and restart to turn the assistant off.
