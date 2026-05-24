export type Store = {
  id: number;
  name: string;
  description?: string | null;
  image_url?: string | null;
  logo_url?: string | null;
  address?: string | null;
  owner_name?: string | null;
  location?: string | null;
  email?: string | null;
  phone?: string | null;
  rating?: number | string | null;
  delivery_time?: string | null;
  opening_time?: string | null;
  closing_time?: string | null;
  priority?: number | string | null;
  is_active?: boolean | number;
  is_closed?: boolean | number;
  is_customer_visible?: boolean | number;
  status_message?: string | null;
  payment_term?: string | null;
  payment_grace_days?: number | string | null;
  payment_grace_start_date?: string | null;
  payment_grace_due_date?: string | null;
  store_discount_apply_all_products?: boolean | number;
  store_discount_percent?: number | string | null;
  bank_id?: number | string | null;
  store_bank_account_title?: string | null;
  store_bank_account_number?: string | null;
};

export type Product = {
  id: number;
  name: string;
  description?: string | null;
  price: number | string;
  cost_price?: number | string | null;
  stock_quantity?: number | string | null;
  original_price?: number | string | null;
  promotional_price?: number | string | null;
  image_url?: string | null;
  store_id?: number;
  category_id?: number | null;
  unit_id?: number | null;
  size_id?: number | null;
  discount_type?: "amount" | "percent" | string | null;
  discount_value?: number | string | null;
  profit_type?: "amount" | "percent" | string | null;
  profit_value?: number | string | null;
  manual_cost_override?: boolean | number;
  manual_variant_cost_override?: boolean | number;
  store_name?: string;
  category_name?: string;
  has_active_offer?: boolean | number;
  offer_badge?: string | null;
};

export type Category = {
  id: number;
  name: string;
  image_url?: string | null;
};

export type User = {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string | null;
  address?: string | null;
  store_id?: number | null;
  is_active?: boolean | number;
  is_verified?: boolean | number;
  user_type: "admin" | "customer" | "store_owner" | "rider" | "guest" | string;
};

export type AuthResponse = {
  success?: boolean;
  token?: string;
  accessToken?: string;
  refreshToken?: string;
  user?: User;
};

export type Order = {
  id: number;
  order_number?: string;
  user_id?: number | string;
  customer_name?: string;
  rider_id?: number | null;
  rider_name?: string | null;
  payment_status?: string;
  status?: string;
  total_amount?: number | string;
  created_at?: string;
};

export type Rider = {
  id: number;
  first_name: string;
  last_name: string;
  full_name?: string;
  father_name?: string;
  email?: string;
  phone?: string;
  vehicle_type?: string;
  license_number?: string;
  id_card_num?: string;
  is_available?: boolean | number;
  is_active?: boolean | number;
};

export type Expense = {
  id: number;
  expense_number?: string;
  category?: string;
  description?: string;
  amount?: number | string;
  payment_method?: string;
  status?: string;
  expense_date?: string;
};

export type FinancialDashboard = {
  income?: number | string;
  expense?: number | string;
  cashInHand?: number | string;
  totalStoreBalances?: number | string;
  storeBalances?: number | string;
  netProfit?: number | string;
};
