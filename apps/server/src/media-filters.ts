import {
  remappedDuration,
  speedAt,
  type MediaOperation,
  type SpeedCurve,
} from "@tadacut/domain";
const decimal = (n: number) => Number(n.toFixed(9)).toString();
export function tempoFilters(speed: number) {
  const parts: string[] = [];
  let v = speed;
  while (v > 2) {
    parts.push("atempo=2");
    v /= 2;
  }
  while (v < 0.5) {
    parts.push("atempo=0.5");
    v /= 0.5;
  }
  parts.push(`atempo=${decimal(v)}`);
  return parts.join(",");
}
/** Exact integral of linear speed against source time, in FFmpeg expression syntax. */
export function speedTimestampExpression(duration: number, points: SpeedCurve) {
  const t = "(PTS-STARTPTS)*TB",
    terms: string[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      length = (b.position - a.position) * duration,
      slope = (b.speed - a.speed) / length;
    const span = `clip(${t}-${decimal(a.position * duration)},0,${decimal(length)})`;
    terms.push(
      Math.abs(slope) < 1e-9
        ? `(${span})/${decimal(a.speed)}`
        : `log((${decimal(a.speed)}+${decimal(slope)}*(${span}))/${decimal(a.speed)})/${decimal(slope)}`,
    );
  }
  return `(${terms.join("+")})/TB`;
}
export function processingFilterGraph(
  operation: MediaOperation,
  duration: number,
  fps: number,
  hasVideo: boolean,
  hasAudio: boolean,
) {
  const filters: string[] = [],
    maps: string[] = [];
  let outDuration = duration;
  const video: string[] = [];
  const audio: string[] = [];
  if (operation.type === "speed-curve") {
    outDuration = remappedDuration(duration, operation.points);
    video.push(
      `setpts='${speedTimestampExpression(duration, operation.points)}'`,
      `fps=${decimal(fps)}`,
    );
    if (hasAudio) {
      // Subdivide each ramp. Exact integrated segment duration keeps audio/video endpoints aligned.
      const slices: { start: number; end: number; speed: number }[] = [];
      for (let i = 1; i < operation.points.length; i++) {
        const a = operation.points[i - 1],
          b = operation.points[i];
        const steps = Math.max(
          1,
          Math.ceil(Math.abs(Math.log(b.speed / a.speed)) / 0.025),
          Math.ceil(((b.position - a.position) * duration) / 2),
        );
        for (let j = 0; j < steps; j++) {
          const start = a.position + ((b.position - a.position) * j) / steps,
            end = a.position + ((b.position - a.position) * (j + 1)) / steps;
          const target =
            remappedDuration(duration, operation.points, end) -
            remappedDuration(duration, operation.points, start);
          slices.push({
            start: start * duration,
            end: end * duration,
            speed: ((end - start) * duration) / target,
          });
        }
      }
      if (slices.length > 2048) throw new Error("速度曲线过长，请分段处理");
      filters.push(
        `[0:a]asplit=${slices.length}${slices.map((_, i) => `[s${i}]`).join("")}`,
      );
      slices.forEach((s, i) =>
        filters.push(
          `[s${i}]atrim=start=${decimal(s.start)}:end=${decimal(s.end)},asetpts=PTS-STARTPTS,${tempoFilters(s.speed)}[a${i}]`,
        ),
      );
      filters.push(
        `${slices.map((_, i) => `[a${i}]`).join("")}concat=n=${slices.length}:v=0:a=1,apad,atrim=duration=${decimal(outDuration)}[aout]`,
      );
      maps.push("-map", "[aout]");
    }
  } else if (operation.type === "reverse") {
    video.push("reverse", "setpts=PTS-STARTPTS");
    audio.push("areverse", "asetpts=PTS-STARTPTS");
  } else if (operation.type === "interpolate")
    video.push(
      `minterpolate=fps=${decimal(operation.fps)}:mi_mode=${operation.method === "blend" ? "blend" : "mci"}:mc_mode=aobmc:me_mode=bidir:vsbmc=1`,
    );
  else if (operation.type === "stabilize")
    video.push(
      `deshake=rx=${Math.ceil(operation.strength / 16) * 16}:ry=${Math.ceil(operation.strength / 16) * 16}:edge=mirror`,
      ...(operation.crop
        ? [
            "crop=iw*0.94:ih*0.94",
            "scale=trunc(iw/0.94/2)*2:trunc(ih/0.94/2)*2",
          ]
        : []),
    );
  else if (operation.type === "proxy")
    video.push(`scale=w='min(${operation.width},iw)':h=-2`);
  else if (operation.type === "voice") {
    const semitones =
        operation.semitones +
        (operation.preset === "deep"
          ? -4
          : operation.preset === "bright"
            ? 3
            : 0),
      pitch = 2 ** (semitones / 12);
    audio.push(
      "aresample=48000",
      `asetrate=${decimal(48000 * pitch)}`,
      "aresample=48000",
      tempoFilters(1 / pitch),
    );
    if (operation.preset === "radio")
      audio.push(
        "highpass=f=300",
        "lowpass=f=3400",
        "acompressor=threshold=0.1:ratio=4",
      );
    if (operation.preset === "echo") audio.push("aecho=0.8:0.7:70|140:0.3|0.2");
    if (operation.preset === "robot") audio.push("tremolo=f=40:d=0.85");
    const left = Math.min(1, 1 - operation.pan),
      right = Math.min(1, 1 + operation.pan);
    audio.push(
      "aformat=channel_layouts=stereo",
      `pan=stereo|c0=${decimal(left)}*c0|c1=${decimal(right)}*c1`,
      "apad",
      `atrim=duration=${decimal(duration)}`,
    );
  }
  if (hasVideo) {
    filters.push(`[0:v]${video.length ? video.join(",") : "null"}[vout]`);
    maps.push("-map", "[vout]");
  }
  if (hasAudio && operation.type !== "speed-curve") {
    filters.push(`[0:a]${audio.length ? audio.join(",") : "anull"}[aout]`);
    maps.push("-map", "[aout]");
  }
  return { filter: filters.join(";"), maps, duration: outDuration };
}
