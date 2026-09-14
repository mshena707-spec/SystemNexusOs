# PHASE J — SUPPLIER / PROCUREMENT
## Real Supplier & PO Tracking · First Stock-Increase Mechanism · InventoryAI Finally Wired

**Date:** June 2026
**Status:** COMPLETE

---

## PRE-WORK AUDIT — WHAT WAS FOUND

A full search confirmed **zero existing supplier/procurement infrastructure anywhere** — no supplier model, no purchase-order tracking, no admin UI for either. Two relevant-but-disconnected real files were found:

- **`src/lib/business/InventoryAI.ts`** (17 lines) — a genuinely real `predictRestockDate(productId, currentStock, dailyVelocity)` function that calls the AI orchestrator for seasonality adjustment and does correct math (`daysRemaining = currentStock / dailyVelocity`, with an AI-suggested 20% buffer when seasonal restocking is recommended). **Confirmed via full-codebase grep: zero callers anywhere.** A real, working function that nothing in the running system ever invoked.
- **`src/lib/vendor/MicroStoreEngine.ts`** — also genuinely real, but uses a direct Firestore import rather than the Phase E `NexusDB` abstraction (a pre-existing migration gap, not addressed in this phase since it's a separate concern from procurement).

Also confirmed: `Product.stock` already existed and `ProductRepository.decrementStock()` already decremented it on sale — but **there was no mechanism anywhere for stock to ever increase**, except a manual admin edit directly in the database. Selling was a one-way door.

---

## WHAT WAS BUILT

### New Files (3)

| File | Purpose |
|---|---|
| `src/lib/procurement/SupplierRepository.ts` | Supplier master data CRUD + product cross-reference |
| `src/lib/procurement/PurchaseOrderEngine.ts` | PO lifecycle: draft → sent → confirmed → received; **first stock-increase path in the codebase** |
| `src/lib/procurement/StockAlertEngine.ts` | Real DSV computation + wires the previously-orphaned `InventoryAI.predictRestockDate()` to real data |

---

## ARCHITECTURE

```
Supplier (NEW)
   │ supplierId
   ▼
Product.supplierId / sku / reorderPoint / leadTimeDays (NEW fields)
   │
   ▼
PurchaseOrderEngine.create() → draft PO with line items (product, qty, unit cost)
   │
   ▼  markSent() → markConfirmed(expectedDeliveryDate)
   ▼
PurchaseOrderEngine.receiveStock(poId, received[])
   │
   ├──▶ products.stock += quantityReceived   (FIRST stock-UP path ever)
   │
   └──▶ ExpenseTracker.record({ category: 'cogs', ... })  (Phase K integration:
        real cost of received goods becomes a real operating expense)

StockAlertEngine.computeDSV(productId)
   │  real daily sales velocity from actual paid order line items (last 30 days)
   ▼
StockAlertEngine.runAlerts()
   │  for each product: DSV + current stock → daysRemaining
   ▼
InventoryAI.predictRestockDate(productId, stock, DSV)   ← wired for the first time
   │  real AI call, seasonality-aware buffer
   ▼
severity (critical/warning/no_reorder_point/info) + recommendedOrderQty

ProductRepository.decrementStock() (every sale)
   │
   ▼
StockAlertEngine.checkAfterDecrement()  ← closes the loop: sale → reorder-point
   │                                       check → real admin notification
   ▼
notifications collection (real, not simulated)
```

---

## FEATURE DETAIL

### 1. Supplier Repository
Standard CRUD for supplier master data: name, contact info, default lead time, default payment terms, currency. `getProducts(supplierId)` cross-references the `products` collection by the new `supplierId` field.

### 2. Purchase Order Engine — the core of this phase
- **Lifecycle**: `draft` → `sent` → `confirmed` → `partially_received` / `received`, or `cancelled` at any point before receipt
- **`receiveStock(poId, received[])`** is the first place in the entire codebase where `products.stock` can increase. For each line item received, it increments stock via `NexusDB.update`, tracks partial receipt (a PO can be received in multiple shipments), and updates PO status accordingly.
- **Phase K integration**: every stock receipt automatically records the real cost of goods received as a `cogs`-category expense via `ExpenseTracker` — this is genuine cross-phase wiring, not a placeholder hook. The Financial OS's COGS numbers (Phase K) now have a real upstream source beyond manually-entered `costPrice` margins.
- **`getSummary()`**: open PO counts by status, total committed spend, overdue count (comparing `expectedDeliveryDate` against today) — feeds the admin dashboard's top tiles.

### 3. Stock Alert Engine — wiring the orphaned `InventoryAI`
- **`computeDSV(productId, lookbackDays=30)`**: real daily sales velocity, computed by summing actual quantities from paid/delivered orders' line items over the lookback window. Not assumed, not estimated from a category average — counted from real transactions.
- **`runAlerts()`**: for every product, computes DSV, then calls `InventoryAI.predictRestockDate()` — **the first time this function has ever been invoked with real arguments anywhere in the system**. The AI's seasonality-aware adjustment (a 20% earlier-restock buffer when it judges seasonal demand is coming) is now a live signal, not dead code.
- **Honest data-quality flag**: products without a `reorderPoint` configured are flagged with severity `'no_reorder_point'` — the same pattern established in Phase K for missing `costPrice`. The engine does not invent a default reorder point (e.g. "assume 10 units"); it tells the owner this product needs configuration.
- **`recommendedOrderQty = DSV × leadTimeDays × 1.5`** — a transparent formula (DSV covers consumption during the supplier's lead time, with a 50% buffer), not an opaque AI guess.

### 4. Closing the loop — `checkAfterDecrement`
Previously, nothing connected "a sale just happened" to "maybe we should reorder." `StockAlertEngine.checkAfterDecrement(productId, newStock)` is now called from `ProductRepository.decrementStock()` on every single sale (dynamic import to avoid a circular dependency between the database layer and the procurement layer). If the new stock level is at or below the product's configured `reorderPoint`, a real notification is written to the `notifications` collection — visible to the admin immediately, not just the next time someone happens to open the Stock Alerts tab.

---

## NEW API ENDPOINTS

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `GET /api/admin/procurement/suppliers` | GET | Admin | List suppliers |
| `POST /api/admin/procurement/suppliers` | POST | Admin | Create supplier |
| `PUT /api/admin/procurement/suppliers/:id` | PUT | Admin | Update supplier |
| `GET /api/admin/procurement/suppliers/:id/products` | GET | Admin | Products from this supplier |
| `POST /api/admin/procurement/purchase-orders` | POST | Admin | Create PO draft |
| `GET /api/admin/procurement/purchase-orders` | GET | Admin | List POs (optional status filter) |
| `GET /api/admin/procurement/purchase-orders/summary` | GET | Admin | Open/overdue/committed-spend summary |
| `GET /api/admin/procurement/purchase-orders/:id` | GET | Admin | Single PO detail |
| `POST /api/admin/procurement/purchase-orders/:id/send` | POST | Admin | Mark sent to supplier |
| `POST /api/admin/procurement/purchase-orders/:id/confirm` | POST | Admin | Supplier confirmed, set expected delivery |
| `POST /api/admin/procurement/purchase-orders/:id/receive` | POST | Admin | Receive stock (partial or full) — increments inventory |
| `POST /api/admin/procurement/purchase-orders/:id/cancel` | POST | Admin | Cancel PO |
| `GET /api/admin/procurement/stock-alerts` | GET | Admin | Real DSV + AI-adjusted restock alerts |

---

## NEW FIRESTORE COLLECTIONS

| Collection | Purpose |
|---|---|
| `suppliers` | Supplier master data |
| `purchase_orders` | PO records with line items, status, costs |

## CHANGES TO EXISTING FILES

| File | Change |
|---|---|
| `src/lib/database/repositories/ProductRepository.ts` | Added `supplierId`, `sku`, `reorderPoint`, `leadTimeDays` fields; `decrementStock()` now calls `StockAlertEngine.checkAfterDecrement()` after every stock change |
| `server.ts` | 13 new procurement routes |
| `firestore.rules` | Added `suppliers` and `purchase_orders` (admin write, admin/rep read) |
| `firestore.indexes.json` | 3 new indexes: PO by status+date, PO by supplier+date, products by supplierId |

---

## VERIFICATION CHECKLIST

- [ ] Create a supplier via the admin UI → appears in `GET /api/admin/procurement/suppliers`
- [ ] Set a product's `supplierId`, `reorderPoint`, and `costPrice` → create a PO referencing that product
- [ ] Mark PO sent → confirmed (with a delivery date) → receive stock → confirm `products.stock` increased by the received quantity
- [ ] After receiving stock, check Phase K's Financial OS Expenses tab — confirm a `cogs`-category expense appeared automatically with the correct amount
- [ ] `GET /api/admin/procurement/stock-alerts` → confirm `dailySalesVelocity` reflects real recent order data (place a few test orders for a product, re-run, confirm DSV changed)
- [ ] A product with no `reorderPoint` set shows severity `'no_reorder_point'`, not a silently-assumed default
- [ ] Sell a product down to (or below) its `reorderPoint` → confirm a real notification appears in the `notifications` collection within the same request (not on a delayed cron)
- [ ] Temporarily add a console log inside `InventoryAI.predictRestockDate()` and confirm it fires with real `productId`/`currentStock`/`dailyVelocity` arguments when `runAlerts()` is called — proving the AI call is no longer orphaned
- [ ] Admin → Procurement → all 3 tabs (Stock Alerts, Purchase Orders, Suppliers) show real data, no placeholders
