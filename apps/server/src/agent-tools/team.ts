import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ToolEffect } from "../../../../packages/agent/src/runner";
import { tool, type ToolHost } from "./host";
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,180}$/),
  remote = { remoteId: id };
export function teamTools(h: ToolHost) {
  const request = (
    method: "GET" | "POST" | "DELETE",
    url: string,
    body?: unknown,
  ) => {
    if (!h.application) throw new Error("应用服务不可用");
    return h.application.request(method, url, body);
  };
  const make = (
    name: string,
    effect: ToolEffect,
    description: string,
    schema: z.ZodTypeAny,
    execute: (a: any) => unknown,
  ) =>
    tool(
      "team",
      effect,
      name,
      description,
      zodToJsonSchema(schema, { $refStrategy: "none" }) as Record<
        string,
        unknown
      >,
      (raw) => execute(schema.parse(raw)),
    );
  return [
    make(
      "read_team_space",
      "read",
      "读取团队连接、身份、成员、项目、版本、评论、评审或本地签出关系；不返回访问密钥。",
      z
        .object({
          section: z.enum([
            "config",
            "me",
            "members",
            "projects",
            "versions",
            "comments",
            "reviews",
            "checkouts",
          ]),
          remoteId: id.optional(),
        })
        .strict(),
      (a) => {
        if (["versions", "comments"].includes(a.section) && !a.remoteId)
          throw new Error("需要远程项目 ID");
        return request(
          "GET",
          `/api/team/${["versions", "comments"].includes(a.section) ? `projects/${a.remoteId}/${a.section}` : a.section}`,
        );
      },
    ),
    make(
      "configure_team_connection",
      "manage",
      "设置团队服务地址与名称。访问凭据由用户在团队设置填写；更换地址需要清除原凭据。",
      z
        .object({
          name: z.string().max(100),
          baseUrl: z.string().url(),
          clearToken: z.boolean().optional(),
        })
        .strict(),
      (a) => request("POST", "/api/team/config", a),
    ),
    make(
      "host_team_space",
      "manage",
      "启动或停止本机团队服务。allowLan=true 才允许局域网成员连接。启动后自动连接本机空间。",
      z
        .object({
          enabled: z.boolean(),
          port: z.number().int().min(1024).max(65535).default(4399),
          allowLan: z.boolean().default(false),
        })
        .strict(),
      (a) => request("POST", "/api/team/host", a),
    ),
    make(
      "create_team_member",
      "manage",
      "创建团队成员，邀请凭据保存在本机，在团队界面复制给成员。",
      z
        .object({
          name: z.string().min(1).max(100),
          role: z.enum(["member", "admin"]).default("member"),
        })
        .strict(),
      (a) => request("POST", "/api/team/members", a),
    ),
    make(
      "remove_team_member",
      "manage",
      "撤销成员的团队访问权限。",
      z.object({ memberId: z.string().uuid() }).strict(),
      (a) => request("DELETE", `/api/team/members/${a.memberId}`),
    ),
    make(
      "push_team_project",
      "publish",
      "把当前已保存项目及本地媒体上传到团队。更新必须提供远程 expectedVersion，冲突会拒绝覆盖。",
      z
        .object({
          remoteId: id.optional(),
          expectedVersion: z.number().int().nonnegative().default(0),
        })
        .strict(),
      (a) =>
        request("POST", "/api/team/projects/push", {
          ...a,
          projectId: h.projectId,
          expectedRevision: h.project().revision,
        }),
    ),
    make(
      "pull_team_project",
      "manage",
      "下载远程项目或指定历史版本为新的本地项目，校验所有媒体文件。",
      z
        .object({ ...remote, version: z.number().int().positive().optional() })
        .strict(),
      (a) =>
        request("POST", `/api/team/projects/${a.remoteId}/pull`, {
          version: a.version,
        }),
    ),
    make(
      "set_team_project_access",
      "manage",
      "给已有成员设置项目编辑/只读权限，或移除权限。",
      z
        .object({
          ...remote,
          memberId: z.string(),
          role: z.enum(["editor", "viewer", "remove"]),
        })
        .strict(),
      (a) =>
        request("POST", `/api/team/projects/${a.remoteId}/members`, {
          memberId: a.memberId,
          role: a.role,
        }),
    ),
    make(
      "comment_team_project",
      "publish",
      "向远程项目添加带时间点和版本的评审意见。",
      z
        .object({
          ...remote,
          text: z.string().min(1).max(4000),
          version: z.number().int().positive(),
          frame: z.number().int().nonnegative().optional(),
          timelineId: z.string().optional(),
        })
        .strict(),
      (a) => {
        const { remoteId, ...body } = a;
        return request("POST", `/api/team/projects/${remoteId}/comments`, body);
      },
    ),
    make(
      "resolve_team_comment",
      "manage",
      "标记或重新打开团队评审意见。",
      z.object({ ...remote, commentId: id, resolved: z.boolean() }).strict(),
      (a) =>
        request(
          "POST",
          `/api/team/projects/${a.remoteId}/comments/${a.commentId}/resolve`,
          { resolved: a.resolved },
        ),
    ),
    make(
      "share_team_review",
      "publish",
      "创建固定版本、会过期的评审链接。可附带本项目已有 MP4 导出 exportId；访问者可以按帧留言。",
      z
        .object({
          ...remote,
          days: z.number().int().min(1).max(90).default(7),
          exportId: id.optional(),
        })
        .strict(),
      (a) => {
        const { remoteId, ...body } = a;
        return request("POST", `/api/team/projects/${remoteId}/reviews`, {
          ...body,
          localProjectId: h.projectId,
        });
      },
    ),
    make(
      "revoke_team_review",
      "manage",
      "撤销一条评审分享链接。",
      z.object({ ...remote, reviewId: id }).strict(),
      (a) =>
        request(
          "DELETE",
          `/api/team/projects/${a.remoteId}/reviews/${a.reviewId}`,
        ),
    ),
    make(
      "search_shared_catalog",
      "external",
      "搜索所连接团队真实发布的模板、贴纸和音频。空目录会返回空列表。",
      z
        .object({
          query: z.string().max(200).default(""),
          kind: z.enum(["template", "sticker", "audio"]).optional(),
        })
        .strict(),
      (a) =>
        request(
          "GET",
          `/api/team/catalog?q=${encodeURIComponent(a.query)}${a.kind ? `&kind=${a.kind}` : ""}`,
        ),
    ),
    make(
      "publish_shared_catalog",
      "publish",
      "发布当前工程为模板，或发布指定贴纸/音频素材到团队素材库。需填写实际授权说明。",
      z
        .object({
          title: z.string().min(1).max(150),
          kind: z.enum(["template", "sticker", "audio"]),
          description: z.string().max(3000).default(""),
          tags: z.array(z.string().max(50)).max(20).default([]),
          license: z.string().min(1).max(300),
          assetId: id.optional(),
        })
        .strict(),
      (a) =>
        request("POST", "/api/team/catalog", {
          ...a,
          projectId: h.projectId,
          expectedRevision: h.project().revision,
        }),
    ),
    make(
      "import_shared_catalog",
      "manage",
      "下载共享条目。模板建立新项目；音频/贴纸通过本次草稿或自动编辑加入当前项目，可撤销。",
      z.object({ itemId: id }).strict(),
      async (a) => {
        const result = (await request(
          "POST",
          `/api/team/catalog/${a.itemId}/import`,
          {
            projectId: h.projectId,
            expectedRevision: h.project().revision,
            prepare: true,
          },
        )) as any;
        return result.commands
          ? h.edit("导入共享素材", result.commands)
          : result;
      },
    ),
    make(
      "remove_shared_catalog",
      "publish",
      "从团队素材库移除自己发布的条目。",
      z.object({ itemId: id }).strict(),
      (a) => request("DELETE", `/api/team/catalog/${a.itemId}`),
    ),
  ];
}
