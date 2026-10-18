import {
  activeTimeline,
  durationInFrames,
  editPoints,
  markedSpan,
  type Timeline,
} from "@tadacut/domain";
import { getState, notify, remember, setState, type Marks } from "./store";

const current = () => {
  const p = getState().project;
  return p ? activeTimeline(p) : null;
};
export const marksOf = (t: Timeline): Marks => getState().marks[t.id] ?? {};
/** The span loop playback and range export use, or null when nothing usable is marked. */
export const markedRange = (t: Timeline) => markedSpan(t, marksOf(t));
const lastFrame = (t: Timeline) => Math.max(0, durationInFrames(t) - 1);
export function seek(frame: number) {
  setState({
    playhead: Math.max(0, Math.round(frame)),
    playing: false,
    rate: 1,
  });
}
export function pause() {
  setState({ playing: false, rate: 1 });
}
function start(rate: number) {
  const t = current();
  if (!t) return;
  const range = getState().loop ? markedRange(t) : null;
  let frame = getState().playhead;
  if (range && (frame < range.start || frame >= range.end))
    frame = rate > 0 ? range.start : range.end - 1;
  else if (rate > 0 && frame >= lastFrame(t)) frame = range?.start ?? 0;
  else if (rate < 0 && frame <= 0) return;
  setState({ playing: true, rate, playhead: frame });
}
export function togglePlay() {
  if (getState().playing) pause();
  else start(1);
}
/** J and L: start playing in that direction, or double the speed up to 8×. */
export function shuttle(direction: 1 | -1) {
  const { playing, rate } = getState();
  if (!playing || Math.sign(rate) !== direction) start(direction);
  else setState({ rate: Math.max(-8, Math.min(8, rate * 2)) });
}
export function step(frames: number) {
  const t = current();
  if (!t) return;
  seek(
    Math.min(
      Math.max(lastFrame(t), getState().playhead),
      getState().playhead + frames,
    ),
  );
}
export function stepEditPoint(direction: 1 | -1) {
  const t = current();
  if (!t) return;
  const frame = getState().playhead,
    points = editPoints(t),
    target =
      direction > 0
        ? points.find((p) => p > frame)
        : [...points].reverse().find((p) => p < frame);
  if (target !== undefined) seek(target);
}
export function seekEnd() {
  const t = current();
  if (t) seek(durationInFrames(t));
}
function setMarks(t: Timeline, marks: Marks) {
  const all = { ...getState().marks };
  if (marks.in === undefined && marks.out === undefined) delete all[t.id];
  else all[t.id] = marks;
  setState({ marks: all });
  remember("tadacut-marks", all);
}
/** I: mark the playhead frame as the first frame; an out mark before it is dropped. */
export function markIn(frame = getState().playhead) {
  const t = current();
  if (!t) return;
  const { out } = marksOf(t);
  setMarks(t, {
    in: frame,
    out: out !== undefined && out > frame ? out : undefined,
  });
}
/** O: mark the playhead frame as the last frame. */
export function markOut(frame = getState().playhead) {
  const t = current();
  if (!t) return;
  const end = frame + 1,
    { in: first } = marksOf(t);
  setMarks(t, {
    in: first !== undefined && first < end ? first : undefined,
    out: end,
  });
}
export function moveMark(which: "in" | "out", frame: number) {
  const t = current();
  if (!t) return;
  const marks = marksOf(t),
    value = Math.max(0, Math.round(frame));
  if (which === "in")
    setMarks(t, {
      ...marks,
      in: marks.out === undefined ? value : Math.min(value, marks.out - 1),
    });
  else setMarks(t, { ...marks, out: Math.max(value, (marks.in ?? -1) + 1, 1) });
}
export function clearMarks(which: "in" | "out" | "both") {
  const t = current();
  if (!t) return;
  const marks = marksOf(t);
  setMarks(
    t,
    which === "both"
      ? {}
      : which === "in"
        ? { out: marks.out }
        : { in: marks.in },
  );
}
export function goToMark(which: "in" | "out") {
  const t = current();
  if (!t) return;
  const marks = marksOf(t);
  if (which === "in" && marks.in !== undefined) seek(marks.in);
  else if (which === "out" && marks.out !== undefined) seek(marks.out - 1);
}
/** /: mark the selected clips, or the clip under the playhead on the uppermost track. */
export function markClip() {
  const t = current();
  if (!t) return;
  const { selectedClipIds, playhead } = getState();
  let clips = t.clips.filter((c) => selectedClipIds.includes(c.id));
  if (!clips.length) {
    const under = t.clips.filter(
      (c) => c.start <= playhead && playhead < c.start + c.duration,
    );
    const order = (id: string) =>
      t.tracks.findIndex((track) => track.id === id);
    clips = under
      .sort((a, b) => order(a.trackId) - order(b.trackId))
      .slice(0, 1);
  }
  if (!clips.length) {
    notify("播放头下没有片段");
    return;
  }
  setMarks(t, {
    in: Math.min(...clips.map((c) => c.start)),
    out: Math.max(...clips.map((c) => c.start + c.duration)),
  });
}
export function toggleLoop() {
  const loop = !getState().loop;
  setState({ loop });
  remember("tadacut-loop", loop);
}
let previous = 0,
  remainder = 0,
  running = false;
/** Moves the playhead by the time since the last animation frame at the shuttle rate. */
export function advance(now: number) {
  const s = getState();
  if (!s.playing || !s.project) {
    running = false;
    return;
  }
  if (!running) {
    running = true;
    previous = now;
    remainder = 0;
    return;
  }
  const t = activeTimeline(s.project);
  remainder += ((now - previous) * t.fps * s.rate) / 1000;
  previous = now;
  const frames = Math.trunc(remainder);
  if (!frames) return;
  remainder -= frames;
  const next = s.playhead + frames,
    range = s.loop ? markedRange(t) : null;
  if (range) {
    const length = range.end - range.start;
    setState({
      playhead:
        range.start + ((((next - range.start) % length) + length) % length),
    });
  } else if (next > lastFrame(t))
    setState({ playhead: lastFrame(t), playing: false, rate: 1 });
  else if (next < 0) setState({ playhead: 0, playing: false, rate: 1 });
  else setState({ playhead: next });
}
