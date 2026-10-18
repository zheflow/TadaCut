// The promo's soundtrack: a 120 BPM groove on the "royal road" progression
// (IV–V–iii–vi), with interface sounds placed on the same cue sheet as the
// animation.
import {
  BPM,
  TOTAL_BARS,
  cues,
  prompt,
  sceneStart,
  seconds,
  type SceneId,
} from "../src/timeline";
import {
  Filter,
  RATE,
  Track,
  bass,
  bell,
  clap,
  click,
  duck,
  hat,
  impact,
  key,
  kick,
  midi,
  pad,
  pingPong,
  pluck,
  reverb,
  riser,
  stats,
  whoosh,
} from "./dsp";

const BEAT = 60 / BPM;
const at = (bar: number, beat = 0) => (bar * 4 + beat) * BEAT;
const chords: Record<string, { notes: number[]; root: number }> = {
  Em7: { notes: [52, 59, 62, 67], root: 40 },
  Am7: { notes: [57, 60, 64, 67], root: 45 },
  Fmaj7: { notes: [53, 60, 64, 69], root: 41 },
  G7: { notes: [55, 62, 65, 71], root: 43 },
  Cmaj9: { notes: [48, 55, 59, 62, 64], root: 36 },
};
const progression = ["Em7", "Am7", "Fmaj7", "G7"];
const chordAt = (bar: number) =>
  chords[bar === TOTAL_BARS - 1 ? "Cmaj9" : progression[bar % 4]];
/** Chord tones from `from` upward, so melodies never clash with the pad. */
function tones(bar: number, from: number, count: number) {
  const classes = chordAt(bar).notes.map((n) => n % 12);
  const out: number[] = [];
  for (let n = from; out.length < count; n++)
    if (classes.includes(n % 12)) out.push(n);
  return out;
}

interface Bar {
  kick?: "full" | "soft";
  clap?: boolean;
  hats?: number;
  bass?: boolean;
  pad?: number;
  arp?: boolean | "soft";
}
function arrangement(bar: number): Bar {
  const s = sceneStart;
  if (bar < s.logo)
    return bar === 0 ? { kick: "soft", hats: 1, pad: 0.55 } : { pad: 0.6 };
  if (bar < s.assistant)
    return { kick: "full", clap: true, hats: 2, bass: true, pad: 1 };
  if (bar < s.assistant + 2)
    return { kick: "full", hats: 1, bass: true, pad: 0.85 };
  if (bar < s.features)
    return { kick: "full", clap: true, hats: 2, bass: true, pad: 1 };
  if (bar < s.trust)
    return {
      kick: "full",
      clap: true,
      hats: 2,
      bass: true,
      pad: 1.1,
      arp: true,
    };
  if (bar < s.numbers) return { pad: 1, arp: "soft" };
  if (bar < s.outro)
    return {
      kick: "full",
      clap: true,
      hats: 2,
      bass: true,
      pad: 1.1,
      arp: true,
    };
  if (bar < TOTAL_BARS - 1)
    return {
      kick: "full",
      hats: bar === TOTAL_BARS - 2 ? 0 : 1,
      bass: true,
      pad: 1,
    };
  return { pad: 0.9 };
}

export function renderSoundtrack() {
  const total = at(TOTAL_BARS),
    length = Math.round(total * RATE);
  const drums = new Track(length),
    music = new Track(length),
    sfx = new Track(length),
    space = new Track(length),
    echo = new Track(length);
  const kicks: number[] = [];
  const K = kick(),
    soft = kick(true),
    C = clap(),
    H = hat(),
    ghost = hat(false, 5);
  const cue = (scene: SceneId, beat: number) => seconds(scene, beat);
  const barOf = (scene: SceneId, beat: number) =>
    sceneStart[scene] + Math.floor(beat / 4);
  const chime = (time: number, note: number, gain = 0.2, decay = 0.9) => {
    const b = bell(midi(note), decay);
    music.add(time, b, gain);
    space.add(time, b, gain * 0.9);
    echo.add(time, b, gain * 0.5);
  };
  const ping = (time: number, note: number, gain = 0.2, pan = 0) => {
    const p = pluck(midi(note), 0.22);
    music.add(time, p, gain, pan);
    echo.add(time, p, gain * 0.6);
    space.add(time, p, gain * 0.3);
  };
  const swish = (time: number, gain = 0.3, seed = 31) => {
    const [l, r] = whoosh(0.55, seed);
    sfx.addStereo(time - 0.3, l, r, gain);
  };
  const boom = (time: number) => {
    const i = impact();
    sfx.add(time, i, 0.9);
    space.add(time, i, 0.25);
  };
  const roll = (bar: number, from: number) => {
    for (let b = from; b < 3.75; b += b < 2 ? 0.5 : 0.25)
      drums.add(at(bar, b), C, 0.1 + 0.28 * (b / 4), 0);
    sfx.add(at(bar), riser(at(1)), 0.35);
  };

  // Groove, bar by bar.
  for (let bar = 0; bar < TOTAL_BARS; bar++) {
    const a = arrangement(bar),
      chord = chordAt(bar);
    for (let b = 0; b < 4; b++) {
      const t = at(bar, b);
      if (a.kick) {
        drums.add(
          t,
          a.kick === "soft" ? soft : K,
          a.kick === "soft" ? 0.7 : 0.8,
        );
        if (a.kick === "full") kicks.push(t);
      }
      if (a.clap && b % 2 === 1) {
        drums.add(t, C, 0.5, 0.05);
        space.add(t, C, 0.16);
      }
      if (a.hats) {
        drums.add(t + BEAT / 2, H, 0.22, 0.25);
        if (a.hats > 1) {
          drums.add(t + BEAT / 4, ghost, 0.09, -0.3);
          drums.add(t + (BEAT * 3) / 4, ghost, 0.09, -0.3);
        }
      }
      if (a.bass) {
        music.add(t, bass(midi(chord.root), BEAT * 0.45), 0.34);
        music.add(t + BEAT / 2, bass(midi(chord.root + 12), BEAT * 0.4), 0.26);
      }
      if (a.arp) {
        const notes = tones(bar, 72, 4);
        // [sixteenth within the beat, chord tone]; the breakdown plays eighths.
        const steps: [number, number][] =
          a.arp === "soft"
            ? [
                [0, b % 2 ? 2 : 0],
                [2, 3],
              ]
            : (b % 2 ? [3, 2, 1, 2] : [0, 1, 2, 3]).map((n, i) => [i, n]);
        const level = a.arp === "soft" ? 0.75 : 1;
        for (const [slot, n] of steps) {
          const p = pluck(midi(notes[n]), 0.16, 0.8);
          const time = t + (slot * BEAT) / 4;
          music.add(
            time,
            p,
            (slot === 0 ? 0.2 : 0.15) * level,
            slot % 2 ? 0.25 : -0.25,
          );
          echo.add(time, p, 0.07);
        }
      }
    }
    if (a.pad) {
      const [l, r] = pad(chord.notes, bar === TOTAL_BARS - 1 ? 1.7 : 2, a.pad);
      // Without drums the pad carries the bar, so it comes forward.
      const level = a.kick ? 1 : 1.45;
      music.addStereo(at(bar), l, r, level);
      space.addStereo(at(bar), l, r, 0.35 * level);
    }
  }

  // Hook: each chore pops on a rising chord tone, then the build to the logo.
  tones(0, 64, 8).forEach((note, i) =>
    ping(cue("hook", cues.hook.chips[i]), note, 0.2, i % 2 ? 0.3 : -0.3),
  );
  swish(cue("hook", cues.hook.collapse) + 0.1, 0.25, 33);
  chime(cue("hook", cues.hook.lines[0]), 81, 0.16);
  chime(cue("hook", cues.hook.lines[1]), 84, 0.14);
  chime(cue("hook", cues.hook.lines[1]), 88, 0.12);
  roll(sceneStart.hook + 1, 0);

  // Logo: impact, the bars, the blossom, the name and the three promises.
  boom(cue("logo", 0));
  [72, 76, 81].forEach((note, i) =>
    ping(cue("logo", cues.logo.bars[i]), note, 0.16),
  );
  chime(cue("logo", cues.logo.blossom), 84, 0.18);
  chime(cue("logo", cues.logo.wordmark), 81, 0.15);
  chime(cue("logo", cues.logo.wordmark), 88, 0.15);
  [83, 86, 91].forEach((note, i) =>
    chime(cue("logo", cues.logo.tagline[i]), note, 0.16),
  );

  // Assistant: typing, send, steps, the click that applies the plan.
  const a = cues.assistant;
  swish(cue("assistant", 0) + 0.15, 0.3);
  [...prompt].forEach((_, i) => {
    const beat =
      a.type[0] + ((i + 1) / prompt.length) * (a.type[1] - a.type[0]);
    sfx.add(cue("assistant", beat), key(100 + i), 0.14, (i % 3) * 0.1 - 0.1);
  });
  sfx.add(cue("assistant", a.send), click(1800), 0.28);
  [81, 84, 88, 93].forEach((note, i) =>
    ping(cue("assistant", a.steps[i]), note, 0.17),
  );
  ping(cue("assistant", a.proposal), 77, 0.14);
  sfx.add(cue("assistant", a.click), click(2300, 57), 0.32);
  [83, 86, 91].forEach((note) =>
    chime(cue("assistant", a.applied), note, 0.12),
  );
  swish(cue("assistant", 18.2), 0.22, 35);

  // Features: a pass of air on every cut, ticks for marks and snaps.
  for (let i = 0; i < cues.features.count; i++) {
    const start = i * cues.features.length;
    swish(cue("features", start) + 0.05, 0.28, 40 + i);
  }
  for (let k = 0; k < 4; k++)
    sfx.add(
      cue("features", 0.7 + k * 0.22),
      click(1500 + k * 120, 60 + k),
      0.12,
    );
  for (let i = 0; i < 4; i++)
    sfx.add(cue("features", 20 + 1.3 + i * 0.18), click(2600, 70 + i), 0.14);

  // Models: chips come in on chord tones.
  swish(cue("models", 0) + 0.05, 0.26, 50);
  cues.models.chips.forEach((beat, i) => {
    const notes = tones(barOf("models", beat), 76, 6);
    ping(
      cue("models", beat),
      notes[i % notes.length],
      0.1,
      i % 2 ? 0.35 : -0.35,
    );
  });

  // Trust: breakdown with bells, then the second build.
  swish(cue("trust", 0) + 0.05, 0.18, 51);
  [81, 84, 88].forEach((note, i) =>
    chime(cue("trust", cues.trust.cards[i]), note, 0.26, 1.1),
  );
  cues.trust.checks.forEach((beat, i) => {
    sfx.add(cue("trust", beat), click(2000 + i * 200, 80 + i), 0.12);
    ping(cue("trust", beat), [91, 95, 98][i], 0.08);
  });
  roll(sceneStart.trust + 1, 2);

  // Numbers: impact, counters ticking as they settle, the closing line.
  boom(cue("numbers", 0));
  cues.numbers.counts.forEach((beat, i) => {
    for (let k = 1; k <= 10; k++) {
      const progress = 1 - (1 - k / 10) ** (1 / 4);
      sfx.add(
        cue("numbers", beat + progress * 0.9),
        click(3000 + i * 300, 90 + k),
        0.06,
      );
    }
  });
  chime(cue("numbers", cues.numbers.line), 88, 0.14);

  // Outro: the lockup lands, the tagline, then the final chord rings out.
  boom(cue("outro", 0));
  chime(cue("outro", 0.5), 81, 0.15);
  chime(cue("outro", 0.5), 84, 0.15);
  [77, 81, 84].forEach((note, i) =>
    chime(cue("outro", cues.outro.tagline + i * 0.5), note, 0.14),
  );
  [72, 76, 79, 83, 86].forEach((note, i) =>
    chime(at(TOTAL_BARS - 1, i * 0.5), note, 0.15, 1.4),
  );

  const mixdown = new Track(length);
  mixdown.mix(drums);
  mixdown.mix(music, 1, duck(length, kicks, 0.42));
  mixdown.mix(sfx);
  mixdown.mix(reverb(space), 0.55);
  mixdown.mix(pingPong(echo, BEAT * 0.75), 0.5);

  // Clear the rumble below the kick, lift the presence range for small
  // speakers, saturate gently, fade in and out.
  const [lowL, lowR, airL, airR] = [0, 1, 2, 3].map(() => new Filter());
  for (let i = 0; i < length; i++) {
    const l = lowL.run(mixdown.l[i], 32, 0.7, 2),
      r = lowR.run(mixdown.r[i], 32, 0.7, 2);
    mixdown.l[i] = l + 0.7 * airL.run(l, 2600, 0.7, 2);
    mixdown.r[i] = r + 0.7 * airR.run(r, 2600, 0.7, 2);
  }
  const raw = stats(mixdown);
  const drive = 1.4 / 10 ** (raw.peakDb / 20);
  const fadeOut = Math.round(1.6 * RATE);
  for (let i = 0; i < length; i++) {
    const fade = Math.min(1, i / (0.005 * RATE), (length - i) / fadeOut);
    const g = Math.sin((Math.min(1, fade) * Math.PI) / 2);
    mixdown.l[i] = Math.tanh(mixdown.l[i] * drive) * 0.93 * g;
    mixdown.r[i] = Math.tanh(mixdown.r[i] * drive) * 0.93 * g;
  }
  return { track: mixdown, before: raw, after: stats(mixdown) };
}
