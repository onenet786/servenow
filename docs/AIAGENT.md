# AIAgent chat assistant

ServeNow can show the AIAgent chat (text and voice) on every web page: the classic pages and `/next`.
The assistant answers from live ServeNow data through read-only tools. It never places, changes or
cancels orders, and never moves money.

## What it can answer

| Tool | Who | What |
|---|---|---|
| `find_stores` | anyone | Stores matching a name, area or product; open now, hours, delivery time, store notice |
| `find_products` | anyone | Products by name, with price, store and whether they can be ordered now |
| `my_orders` | signed-in customers (also store owners and staff who order) | Their latest 5 orders |
| `order_status` | signed-in | One order in full. Customers see their own orders, riders the orders given to them, store owners their stores' orders, staff all orders |
| `my_wallet` | customers, riders | Wallet balance and latest transactions |
| `rider_deliveries` | riders | Deliveries not finished yet |
| `store_orders_today` | store owners | Today's orders for their stores |
| `business_today` | admin, standard users | Today's platform figures |

Visitors who are not signed in can only use the first two. An unknown order number and somebody
else's order get the same "not found" answer.

## Set up (once)

In the AIAgent dashboard:

1. **Channels → Website → Add.** Under **Allowed websites** list `https://servenow.pk` (and any other
   address customers use). Copy the channel key.
2. On that channel, open **Signed-in users** and click **Turn on and create secret**. Copy the secret
   (it is shown once). Leave *Only signed-in users may chat* off so visitors can ask about stores.
3. **Tools → Connected systems**, type `servenow.pk` and press **Connect**. AIAgent reads
   `https://servenow.pk/.well-known/aiagent.json`, creates the 8 tools and shows one signing secret,
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
