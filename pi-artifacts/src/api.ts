import type { ArtifactMeta, ChatSummary, ProxyRequest, ProxyResponse, ToolInfo } from "../shared/protocol.ts";

export interface ArtifactSummary {
  id: string;
  title: string;
  chatId: string;
  latest: number;
  updatedAt: number;
}

export interface Me {
  uid: string;
  email?: string;
  auth: "access" | "demo";
}

export interface FileInfo {
  path: string;
  size: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error((body as { error?: string }).error ?? response.statusText), { status: response.status });
  return body as T;
}

const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  /** The signed-in user, or null with the Worker's auth mode when nobody is. */
  me: async (): Promise<{ me: Me | null; auth: Me["auth"] }> => {
    const response = await fetch("/api/me", { credentials: "same-origin" });
    const body = (await response.json().catch(() => ({}))) as Partial<Me>;
    const auth = body.auth === "demo" ? "demo" : "access";
    return response.ok && body.uid ? { me: body as Me, auth } : { me: null, auth };
  },
  signIn: (name: string) => request<{ uid: string }>("/api/session", post({ name })),
  signOut: () => request<object>("/api/session", { method: "DELETE" }),
  chats: () => request<ChatSummary[]>("/api/chats"),
  createChat: () => request<ChatSummary>("/api/chats", { method: "POST" }),
  artifacts: () => request<ArtifactSummary[]>("/api/artifacts"),
  artifact: (id: string) => request<Omit<ArtifactMeta, "chatId"> & { isOwner: boolean }>(`/api/artifacts/${id}`),
  artifactTools: (id: string, version: number) => request<ToolInfo[]>(`/api/artifacts/${id}/tools?version=${version}`),
  cloneAccess: (id: string) => request<{ remote: string; token: string; expiresAt: string }>(`/api/artifacts/${id}/clone`, post({})),
  /** Resolves with the Worker's ProxyResponse, errors included; rejects only when the request itself fails. */
  proxy: async (id: string, call: ProxyRequest): Promise<ProxyResponse> => {
    const response = await fetch(`/api/artifacts/${id}/mcp`, { credentials: "same-origin", ...post(call) });
    const body = (await response.json().catch(() => null)) as ProxyResponse | null;
    if (body && typeof body.ok === "boolean") return body;
    throw new Error(`The proxy answered ${response.status}`);
  },
  files: () => request<FileInfo[]>("/api/files"),
  upload: (file: File) => {
    const form = new FormData();
    form.set("file", file);
    return request<{ path: string }>("/api/files", { method: "POST", body: form });
  },
  chatSocketUrl: (chatId: string) => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/chats/${chatId}/ws`,
};
