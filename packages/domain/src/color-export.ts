import { clipSchema, type Project, type Timeline } from "./model";
/** Native high-bit-depth path is deliberately explicit about operations it can preserve. */
export function colorExportSupport(project: Project, timeline: Timeline) {
  const visible = timeline.clips
    .filter(
      (c) =>
        !timeline.tracks.find((t) => t.id === c.trackId)?.hidden &&
        project.assets.find((a) => a.id === c.assetId)?.kind !== "audio",
    )
    .sort((a, b) => a.start - b.start);
  const reasons: string[] = [];
  const defaults = clipSchema.parse({
    id: "default",
    assetId: "default",
    trackId: "default",
    start: 0,
    duration: 1,
  });
  for (const c of visible) {
    const a = project.assets.find((a) => a.id === c.assetId)!;
    if (!["video", "image"].includes(a.kind))
      reasons.push("文字、代码动画或嵌套序列");
    if (c.transition) reasons.push("转场");
    if (
      c.x ||
      c.y ||
      c.rotation ||
      c.scale !== 1 ||
      c.scaleX !== 1 ||
      c.scaleY !== 1 ||
      c.opacity !== 1 ||
      c.radius
    )
      reasons.push("空间变换或透明度");
    if (c.crop && Object.values(c.crop).some((v) => v !== 0))
      reasons.push("自定义裁切");
    if (
      Object.entries(c.keyframes).some(([k, v]) => k !== "volume" && v?.length)
    )
      reasons.push("画面关键帧");
    if (
      JSON.stringify(c.effects) !== JSON.stringify(defaults.effects) ||
      (c.advanced && Object.keys(c.advanced).length)
    )
      reasons.push("画面特效、蒙版或跟踪");
  }
  if (
    visible.some((c, i) =>
      visible.slice(0, i).some((a) => a.start + a.duration > c.start),
    )
  )
    reasons.push("重叠画面图层");
  if (timeline.multicam.length) reasons.push("多机位切换");
  if (timeline.watermark) reasons.push("水印");
  return {
    native: reasons.length === 0,
    reasons: [...new Set(reasons)],
    required: Boolean(
      (timeline.profile &&
        (timeline.profile.workingSpace !== "rec709" ||
          timeline.profile.outputSpace !== "rec709")) ||
        visible.some((c) =>
          project.assets
            .find((a) => a.id === c.assetId)
            ?.colorSpace?.startsWith("rec2020"),
        ),
    ),
  };
}
