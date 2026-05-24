const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "");
const configuredTargetUrl = import.meta.env.VITE_API_TARGET_URL?.replace(/\/$/, "");
export const API_BASE_URL = configuredBaseUrl || "";
export const API_DISPLAY_URL = API_BASE_URL || `the Vite proxy to ${configuredTargetUrl || "the backend API"}`;

type ApiOptions = RequestInit & {
  token?: string | null;
};

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Network request failed";
    throw new ApiError(`Unable to reach ${API_DISPLAY_URL}${path}: ${reason}`, 0, err);
  }
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "message" in payload
        ? String((payload as { message: unknown }).message)
        : `Request failed with ${response.status}`;
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}

export function assetUrl(path?: string | null) {
  if (!path) return "/images/servenow_food_delivery.png";
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalized}`;
}
