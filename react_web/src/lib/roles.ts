import type { User } from "@/lib/types";

export function isAdminLike(user: User | null) {
  return user?.user_type === "admin" || user?.user_type === "standard_user";
}

export function isAdmin(user: User | null) {
  return user?.user_type === "admin";
}

export function isRider(user: User | null) {
  return user?.user_type === "rider";
}

export function isStoreOwner(user: User | null) {
  return user?.user_type === "store_owner";
}

export function roleHome(user: User | null) {
  if (isAdminLike(user)) return "admin";
  if (isRider(user)) return "rider";
  if (isStoreOwner(user)) return "store";
  return "customer";
}
