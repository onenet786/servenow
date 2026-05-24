import { apiFetch } from "@/lib/api";
import type { Order } from "@/lib/types";

export type AdminOrderItem = {
  id: number;
  product_id?: number;
  product_name?: string;
  quantity?: number | string;
  price?: number | string;
  store_id?: number;
  store_name?: string;
  variant_label?: string | null;
};

export type AdminOrderDetail = Order & {
  first_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
  user_id?: number | string;
  delivery_address?: string;
  special_instructions?: string;
  delivery_fee?: number | string;
};

export async function fetchAdminOrderItems(orderId: number, token: string) {
  return apiFetch<{ order?: AdminOrderDetail; items?: AdminOrderItem[] }>(`/api/orders/${orderId}/items`, { token });
}

export async function addAdminOrderItem({
  orderId,
  token,
  productId,
  quantity,
  storeId,
}: {
  orderId: number;
  token: string;
  productId: number;
  quantity: number;
  storeId?: number;
}) {
  return apiFetch(`/api/orders/${orderId}/items/add`, {
    method: "POST",
    token,
    body: JSON.stringify({
      product_id: productId,
      quantity,
      store_id: storeId,
    }),
  });
}

export async function removeAdminOrderItem(orderId: number, itemId: number, token: string) {
  return apiFetch(`/api/orders/${orderId}/items/${itemId}`, { method: "DELETE", token });
}

export async function saveAdminOrderDeliveryFee(orderId: number, token: string, deliveryFee: number) {
  return apiFetch(`/api/orders/${orderId}/delivery-fee`, {
    method: "PUT",
    token,
    body: JSON.stringify({ delivery_fee: deliveryFee }),
  });
}

export async function recalculateAdminOrderDeliveryFee(orderId: number, token: string) {
  return apiFetch(`/api/orders/${orderId}/delivery-fee`, { method: "PUT", token });
}

export async function saveAdminOrderCustomer({
  orderId,
  token,
  customerId,
  deliveryAddress,
  specialInstructions,
}: {
  orderId: number;
  token: string;
  customerId: number;
  deliveryAddress: string;
  specialInstructions?: string | null;
}) {
  return apiFetch(`/api/orders/${orderId}/customer`, {
    method: "PUT",
    token,
    body: JSON.stringify({
      customer_id: customerId,
      delivery_address: deliveryAddress,
      special_instructions: specialInstructions || null,
    }),
  });
}
