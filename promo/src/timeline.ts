/**
 * One clock for picture and sound. Scenes start on bar lines and every cue is
 * counted in beats, so the soundtrack and the animation read the same sheet.
 */
export const FPS = 60;
export const BPM = 120;
/** Frames per beat. */
export const BEAT = (FPS * 60) / BPM;
export const BAR = 4 * BEAT;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export const sceneBars = {
  hook: 2,
  logo: 2,
  assistant: 6,
  memory: 4,
  features: 6,
  models: 2,
  trust: 2,
  numbers: 2,
  outro: 3,
};
export type SceneId = keyof typeof sceneBars;
export const sceneOrder = Object.keys(sceneBars) as SceneId[];
/** Bar on which each scene starts. */
export const sceneStart = Object.fromEntries(
  sceneOrder.map((id, i) => [
    id,
    sceneOrder.slice(0, i).reduce((sum, s) => sum + sceneBars[s], 0),
  ]),
) as Record<SceneId, number>;
export const TOTAL_BARS = sceneOrder.reduce((sum, s) => sum + sceneBars[s], 0);
export const DURATION = TOTAL_BARS * BAR;

/** What the viewer types into the assistant. */
export const prompt = "剪成 15 秒竖版，配上字幕";

/** Moments inside each scene, in beats from the scene's first beat. */
export const cues = {
  hook: {
    chips: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
    collapse: 4,
    lines: [4.25, 5.5],
  },
  logo: {
    bars: [0.15, 0.4, 0.65],
    blossom: 0.9,
    wordmark: 2,
    tagline: [4, 5, 6],
  },
  assistant: {
    type: [3, 5],
    send: 5.5,
    reply: 6.25,
    steps: [7, 8, 9, 10],
    proposal: 11,
    click: 13.5,
    applied: 14,
    outro: 18,
  },
  memory: { preference: 1.5, candidate: 3, confirm: 6, recall: 9, reply: 10.5 },
  features: { length: 4, count: 6 },
  models: { chips: [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6] },
  trust: { cards: [1.5, 2.5, 3.5], checks: [4.5, 5, 5.5] },
  numbers: { counts: [0, 1, 2], line: 4.5 },
  outro: { tagline: 2, line: 5, fade: 10 },
};

/** Seconds from the start of the film to a beat inside a scene. */
export const seconds = (scene: SceneId, beat: number) =>
  ((sceneStart[scene] * 4 + beat) * 60) / BPM;
