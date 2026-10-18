import type { Asset } from "@tadacut/domain";
import type { MediaService } from "./media";
import type { Repository } from "./storage";

/** Beats, pauses and loudness of a sound, kept per asset so tools can reuse them. */
export interface AudioAnalysis {
  id: string;
  projectId: string;
  assetId: string;
  hash?: string;
  duration: number;
  bpm: number;
  beats: number[];
  beatConfidence: number;
  silence: { start: number; end: number }[];
  /** RMS per second. */
  energy: number[];
  rmsDb: number;
  createdAt: string;
}
export async function audioAnalysis(
  repo: Repository,
  media: MediaService,
  projectId: string,
  asset: Asset,
  signal: AbortSignal,
): Promise<AudioAnalysis> {
  const id = `${projectId}:${asset.id}`,
    cached = repo.record<AudioAnalysis>("analysis", id);
  if (cached && cached.hash === asset.hash) return cached;
  if (asset.kind !== "audio" && asset.kind !== "video")
    throw new Error("只能分析音频或视频素材");
  const analysis = analysisRecord(
    projectId,
    asset,
    await media.analyze(asset, signal),
  );
  repo.save("analysis", analysis);
  return analysis;
}
/** The cached form of a fresh analysis; the analyze job saves it too. */
export function analysisRecord(
  projectId: string,
  asset: Asset,
  result: Awaited<ReturnType<MediaService["analyze"]>>,
): AudioAnalysis {
  const perSecond = Math.max(1, Math.round(result.envelopeRate)),
    energy: number[] = [];
  for (let i = 0; i < result.envelopes.length; i += perSecond) {
    const slice = result.envelopes.slice(i, i + perSecond);
    energy.push(Math.sqrt(slice.reduce((s, v) => s + v * v, 0) / slice.length));
  }
  return {
    id: `${projectId}:${asset.id}`,
    projectId,
    assetId: asset.id,
    hash: asset.hash,
    duration: result.duration,
    bpm: result.beats.bpm,
    beats: result.beats.beats,
    beatConfidence: result.beats.confidence,
    silence: result.silence,
    energy,
    rmsDb: result.rmsDb,
    createdAt: new Date().toISOString(),
  };
}
