import type { Asset, Project } from "@tadacut/domain";
import type { PublicProvider } from "../../../../packages/providers/src/types";
import type {
  Job,
  Message,
  Proposal,
  Skill,
} from "../../../server/src/storage";
export type { Job, Message, Proposal, Skill, PublicProvider };
let session: Promise<void> | undefined;
export async function request<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  session ??= fetch("/api/session", { credentials: "same-origin" }).then(
    (response) => {
      if (!response.ok) throw new Error("无法连接本地工作台");
    },
  );
  await session;
  const headers = new Headers(init.headers);
  if (
    init.body != null &&
    !(init.body instanceof FormData) &&
    !headers.has("Content-Type")
  )
    headers.set("Content-Type", "application/json");
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.message ?? `请求未完成（${response.status}）`);
  return data as T;
}
export const post = <T>(url: string, value: unknown) =>
  request<T>(url, { method: "POST", body: JSON.stringify(value) });
export async function upload(projectId: string, files: File[]) {
  const results: { project: Project; asset: Asset }[] = [];
  for (const file of files) {
    const form = new FormData();
    form.append("file", file);
    results.push(
      await request<{ project: Project; asset: Asset }>(
        `/api/projects/${projectId}/assets`,
        { method: "POST", body: form },
      ),
    );
  }
  return results;
}
