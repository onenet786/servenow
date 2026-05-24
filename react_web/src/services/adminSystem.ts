import { API_BASE_URL, apiFetch } from "@/lib/api";

export type DeliveryFeeSettings = {
  base_fee?: number | string;
  additional_per_store?: number | string;
};

export type BackupFile = {
  filename: string;
  size?: number;
  mtime?: string;
};

export async function fetchDeliveryFeeSettings(token: string) {
  return apiFetch<DeliveryFeeSettings & { success?: boolean }>("/api/admin/delivery-fee-settings", { token });
}

export async function saveDeliveryFeeSettings(token: string, settings: DeliveryFeeSettings) {
  return apiFetch<DeliveryFeeSettings & { success?: boolean; message?: string }>("/api/admin/delivery-fee-settings", {
    method: "PUT",
    token,
    body: JSON.stringify(settings),
  });
}

export async function listBackups(token: string) {
  return apiFetch<{ success?: boolean; backups?: BackupFile[] }>("/api/admin/backup-db/list", { token });
}

export async function createBackup(token: string, filename: string) {
  return apiFetch<{ success?: boolean; filename?: string; downloadUrl?: string; message?: string }>("/api/admin/backup-db", {
    method: "POST",
    token,
    body: JSON.stringify({ filename }),
  });
}

export async function checkBackupStatus(token: string) {
  return apiFetch<Record<string, unknown>>("/api/admin/backup-db/check", { token });
}

export async function downloadBackup(token: string, filename: string) {
  const response = await fetch(`${API_BASE_URL}/api/admin/backup-db/download?file=${encodeURIComponent(filename)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Download failed with ${response.status}`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
