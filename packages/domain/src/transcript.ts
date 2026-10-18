import type { Timeline, Transcript, Word } from "./model";
export interface TimedWord {
  word: Word;
  clipId: string;
  start: number;
  end: number;
}
export function wordsOnTimeline(
  transcript: Transcript,
  timeline: Timeline,
): TimedWord[] {
  return timeline.clips
    .filter((c) => c.assetId === transcript.assetId)
    .flatMap((c) =>
      transcript.words
        .filter((w) => !w.deleted)
        .flatMap((word) => {
          const begin = Math.max(c.sourceOffset, word.start),
            end = Math.min(
              c.sourceOffset + (c.duration / timeline.fps) * c.speed,
              word.end,
            );
          if (end <= begin) return [];
          return [
            {
              word,
              clipId: c.id,
              start:
                c.start +
                Math.round(((begin - c.sourceOffset) / c.speed) * timeline.fps),
              end:
                c.start +
                Math.round(((end - c.sourceOffset) / c.speed) * timeline.fps),
            },
          ];
        }),
    )
    .sort((a, b) => a.start - b.start);
}
export function subtitleCues(
  transcript: Transcript,
  timeline: Timeline,
  maxWords = 8,
) {
  const groups: TimedWord[][] = [];
  for (const timed of wordsOnTimeline(transcript, timeline)) {
    let group = groups[groups.length - 1],
      previous = group?.[group.length - 1];
    if (
      !group ||
      group.length >= maxWords ||
      previous.clipId !== timed.clipId ||
      previous.word.speaker !== timed.word.speaker ||
      timed.start - previous.end > timeline.fps * 0.8
    ) {
      group = [];
      groups.push(group);
    }
    group.push(timed);
  }
  return groups.map((group) => ({
    start: group[0].start,
    duration: Math.max(1, group[group.length - 1].end - group[0].start),
    text: group.map((w) => w.word.text).join(" "),
    speaker: group[0].word.speaker,
  }));
}
