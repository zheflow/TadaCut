import { homography } from "./advanced";
export interface GrayFrame {
  pixels: Uint8Array;
  width: number;
  height: number;
}
type Point = [number, number];
/** Local normalized cross-correlation tolerates uniform exposure changes. */
export function trackPoint(
  previous: GrayFrame,
  current: GrayFrame,
  point: Point,
  search = 24,
) {
  const radius = 5,
    [px, py] = point.map(Math.round),
    samples: number[] = [];
  for (let y = -radius; y <= radius; y += 2)
    for (let x = -radius; x <= radius; x += 2)
      samples.push(
        previous.pixels[
          Math.max(0, Math.min(previous.height - 1, py + y)) * previous.width +
            Math.max(0, Math.min(previous.width - 1, px + x))
        ],
      );
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length,
    variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0);
  if (variance < 100) return { point, confidence: 0 };
  const score = (x: number, y: number) => {
    if (
      x < radius ||
      y < radius ||
      x >= current.width - radius ||
      y >= current.height - radius
    )
      return -1;
    let sum = 0,
      square = 0,
      cross = 0,
      i = 0;
    for (let dy = -radius; dy <= radius; dy += 2)
      for (let dx = -radius; dx <= radius; dx += 2) {
        const v = current.pixels[(y + dy) * current.width + x + dx];
        sum += v;
        square += v * v;
        cross += (samples[i++] - mean) * v;
      }
    return (
      cross /
      Math.sqrt(Math.max(1, variance * (square - (sum * sum) / samples.length)))
    );
  };
  let best = score(px, py),
    bestRank = best,
    bx = px,
    by = py;
  for (
    let y = Math.max(radius, py - search);
    y <= Math.min(current.height - radius - 1, py + search);
    y++
  )
    for (
      let x = Math.max(radius, px - search);
      x <= Math.min(current.width - radius - 1, px + search);
      x++
    ) {
      const s = score(x, y);
      const rank = s - 0.000005 * ((x - px) ** 2 + (y - py) ** 2);
      if (rank > bestRank) {
        best = s;
        bestRank = rank;
        bx = x;
        by = y;
      }
    }
  const cx = bx,
    cy = by;
  for (let y = cy - 1; y <= cy + 1; y++)
    for (let x = cx - 1; x <= cx + 1; x++) {
      const s = score(x, y);
      const rank = s - 0.000005 * ((x - px) ** 2 + (y - py) ** 2);
      if (rank > bestRank) {
        best = s;
        bestRank = rank;
        bx = x;
        by = y;
      }
    }
  return {
    point: best > 0.45 ? ([bx, by] as Point) : point,
    confidence: Math.max(0, Math.min(1, best)),
  };
}
export function trackRegion(
  previous: GrayFrame,
  current: GrayFrame,
  corners: Point[],
  mode: "position" | "plane",
) {
  const center = corners.reduce(
    (v, p) => [v[0] + p[0] / 4, v[1] + p[1] / 4] as Point,
    [0, 0] as Point,
  );
  const control =
    mode === "position"
      ? [center]
      : corners.map(
          (p) =>
            [
              p[0] * 0.75 + center[0] * 0.25,
              p[1] * 0.75 + center[1] * 0.25,
            ] as Point,
        );
  const found = control.map((p) => trackPoint(previous, current, p));
  const confidence = found.reduce((v, p) => Math.min(v, p.confidence), 1);
  let next = corners;
  if (mode === "position")
    next = corners.map((p) => [
      p[0] + found[0].point[0] - center[0],
      p[1] + found[0].point[1] - center[1],
    ]);
  else if (confidence > 0.45) {
    const h = homography(
      control,
      found.map((p) => p.point),
    );
    if (h)
      next = corners.map(([x, y]) => {
        const d = h[6] * x + h[7] * y + 1;
        return [
          (h[0] * x + h[1] * y + h[2]) / d,
          (h[3] * x + h[4] * y + h[5]) / d,
        ];
      });
  }
  return {
    corners: next.map(
      ([x, y]) =>
        [
          Math.max(0, Math.min(current.width - 1, x)),
          Math.max(0, Math.min(current.height - 1, y)),
        ] as Point,
    ),
    confidence,
  };
}
