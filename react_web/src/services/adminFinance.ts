import { apiFetch } from "@/lib/api";

export function createPaymentVoucher(token: string, payload: Record<string, unknown>) {
  return apiFetch("/api/financial/payment-vouchers", {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
}

export function updatePaymentVoucher(token: string, id: number, payload: Record<string, unknown>) {
  return apiFetch(`/api/financial/payment-vouchers/${id}`, {
    method: "PUT",
    token,
    body: JSON.stringify(payload),
  });
}

export function createReceiptVoucher(token: string, payload: Record<string, unknown>) {
  return apiFetch("/api/financial/receipt-vouchers", {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
}

export function updateReceiptVoucher(token: string, id: number, payload: Record<string, unknown>) {
  return apiFetch(`/api/financial/receipt-vouchers/${id}`, {
    method: "PUT",
    token,
    body: JSON.stringify(payload),
  });
}

export function createRiderCashMovement(token: string, payload: Record<string, unknown>) {
  return apiFetch("/api/financial/rider-cash", {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
}

export function updateRiderCashMovement(token: string, id: number, payload: Record<string, unknown>) {
  return apiFetch(`/api/financial/rider-cash/${id}`, {
    method: "PUT",
    token,
    body: JSON.stringify(payload),
  });
}

export function createStoreSettlement(token: string, payload: Record<string, unknown>) {
  return apiFetch("/api/financial/store-settlements", {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
}

export function updateStoreSettlement(token: string, id: number, payload: Record<string, unknown>) {
  return apiFetch(`/api/financial/store-settlements/${id}`, {
    method: "PUT",
    token,
    body: JSON.stringify(payload),
  });
}
