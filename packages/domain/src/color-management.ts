import type { TimelineProfile } from "./advanced-model";
type Space = TimelineProfile["workingSpace"];
type RGB = [number, number, number];
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const pq = {
  m1: 2610 / 16384,
  m2: 2523 / 32,
  c1: 3424 / 4096,
  c2: 2413 / 128,
  c3: 2392 / 128,
};
/** Linear values are absolute luminance in nits. SDR reference white is 203 nits. */
export function decodeTransfer(value: number, space: Space, peak = 1000) {
  const v = clamp(value);
  if (space === "rec2020-pq") {
    const p = v ** (1 / pq.m2);
    return (
      10000 * (Math.max(0, p - pq.c1) / (pq.c2 - pq.c3 * p)) ** (1 / pq.m1)
    );
  }
  if (space === "rec2020-hlg") {
    const linear =
      v <= 0.5
        ? (v * v) / 3
        : (Math.exp((v - 0.55991073) / 0.17883277) + 0.28466892) / 12;
    return peak * linear ** 1.2;
  }
  if (space === "srgb")
    return 203 * (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 203 * (v < 0.081 ? v / 4.5 : ((v + 0.099) / 1.099) ** (1 / 0.45));
}
export function encodeTransfer(nits: number, space: Space, peak = 1000) {
  const l = Math.max(0, nits);
  if (space === "rec2020-pq") {
    const p = (l / 10000) ** pq.m1;
    return clamp(((pq.c1 + pq.c2 * p) / (1 + pq.c3 * p)) ** pq.m2);
  }
  if (space === "rec2020-hlg") {
    const v = (l / peak) ** (1 / 1.2);
    return clamp(
      v <= 1 / 12
        ? Math.sqrt(3 * v)
        : 0.17883277 * Math.log(12 * v - 0.28466892) + 0.55991073,
    );
  }
  const v = l / 203;
  return clamp(
    space === "srgb"
      ? v <= 0.0031308
        ? 12.92 * v
        : 1.055 * v ** (1 / 2.4) - 0.055
      : v < 0.018
        ? 4.5 * v
        : 1.099 * v ** 0.45 - 0.099,
  );
}
const to2020 = [
  [0.6274039, 0.329283, 0.0433131],
  [0.0690973, 0.9195404, 0.0113623],
  [0.0163914, 0.0880133, 0.8955953],
];
const to709 = [
  [1.660491, -0.5876411, -0.0728499],
  [-0.1245505, 1.1328999, -0.0083494],
  [-0.0181508, -0.1005789, 1.1187297],
];
export function convertColor(
  rgb: RGB,
  input: Space,
  output: Space,
  peak = 1000,
): RGB {
  let linear = rgb.map((v) => decodeTransfer(v, input, peak)) as RGB;
  const hdrIn = input.startsWith("rec2020"),
    hdrOut = output.startsWith("rec2020");
  if (hdrIn !== hdrOut) {
    const m = hdrIn ? to709 : to2020;
    linear = m.map((row) =>
      row.reduce((v, n, i) => v + n * linear[i], 0),
    ) as RGB;
  }
  if (hdrIn && !hdrOut) {
    // Luminance-preserving extended Reinhard shoulder, calibrated to the chosen mastering peak.
    const luminance =
      Math.max(
        0,
        linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722,
      ) / 203;
    const white = peak / 203;
    const mapped =
      (luminance * (1 + luminance / (white * white))) / (1 + luminance);
    if (luminance > 1e-9)
      linear = linear.map((v) => (v * mapped) / luminance) as RGB;
  }
  return linear.map((v) => encodeTransfer(v, output, peak)) as RGB;
}
export function colorConversionCube(
  input: Space,
  output: Space,
  peak = 1000,
  size = 33,
  working?: Space,
) {
  const lines = [
    `TITLE "TadaCut ${input} to ${output}"`,
    `LUT_3D_SIZE ${size}`,
    "DOMAIN_MIN 0 0 0",
    "DOMAIN_MAX 1 1 1",
  ];
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++)
        lines.push(
          (working
            ? convertColor(
                convertColor(
                  [r / (size - 1), g / (size - 1), b / (size - 1)],
                  input,
                  working,
                  peak,
                ),
                working,
                output,
                peak,
              )
            : convertColor(
                [r / (size - 1), g / (size - 1), b / (size - 1)],
                input,
                output,
                peak,
              )
          )
            .map((v) => v.toFixed(8))
            .join(" "),
        );
  return lines.join("\n") + "\n";
}
