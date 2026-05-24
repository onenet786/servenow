import type { Store } from "@/lib/types";

export function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function isDiscountPaymentTerm(term?: string | null) {
  return String(term || "").toLowerCase().includes("discount");
}

export function isProfitPaymentTerm(term?: string | null) {
  const normalized = String(term || "").toLowerCase().trim();
  return normalized === "cash only" || normalized === "credit";
}

export function isCashOnlyPaymentTerm(term?: string | null) {
  return String(term || "").toLowerCase().trim() === "cash only";
}

export function roundProductAmount(value: number) {
  return Math.round(value / 5) * 5;
}

export function calculateProductCost({
  price,
  store,
  discountType,
  discountValue,
  profitType,
  profitValue,
}: {
  price: number;
  store?: Store;
  discountType: string;
  discountValue: number;
  profitType: string;
  profitValue: number;
}) {
  if (!store) return price;

  if (isDiscountPaymentTerm(store.payment_term)) {
    const storeDiscountEnabled = Number(store.store_discount_apply_all_products || 0) === 1;
    const effectiveDiscount = storeDiscountEnabled ? toNumber(store.store_discount_percent) : discountValue;
    const discount = discountType === "percent" ? price * (effectiveDiscount / 100) : effectiveDiscount;
    return roundProductAmount(Math.max(0, price - discount));
  }

  if (isProfitPaymentTerm(store.payment_term)) {
    const profit = profitType === "percent" ? price * (profitValue / 100) : profitValue;
    return roundProductAmount(Math.max(0, price - profit));
  }

  return price;
}
