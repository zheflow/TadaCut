import { useEffect, useRef, useState } from "react";
import {
  AppWindow,
  Circle,
  Keyboard,
  Mic,
  Monitor,
  MousePointer2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { commit, getState, notify, startJob, useStudio } from "../lib/store";
import type {
  AutomationSession,
  AutomationWindow,
  CaptureSource,
} from "../../../../packages/platform/src/contract";
import { upload } from "../lib/api";
export function RecordingView() {
  const [sources, setSources] = useState<CaptureSource[]>([]),
    [windows, setWindows] = useState<AutomationWindow[]>([]),
    [source, setSource] = useState(""),
    [mic, setMic] = useState(true),
    [systemAudio, setSystemAudio] = useState(false),
    [recording, setRecording] = useState(false),
    [voiceOnly, setVoiceOnly] = useState(false),
    [elapsed, setElapsed] = useState(0),
    [session, setSession] = useState<AutomationSession | null>(null),
    [target, setTarget] = useState(""),
    [text, setText] = useState(""),
    [promptText, setPromptText] = useState(""),
    [permissions, setPermissions] = useState<any>(null);
  const providers = useStudio((s) => s.providers);
  const video = useRef<HTMLVideoElement>(null),
    recorder = useRef<MediaRecorder>(null),
    streams = useRef<MediaStream[]>([]),
    audio = useRef<AudioContext | null>(null),
    startTime = useRef(0),
    sessionRef = useRef(session);
  sessionRef.current = session;
  useEffect(() => {
    if (window.tadacut)
      void window.tadacut
        .status()
        .then(setPermissions)
        .catch((e) => notify(String(e), true));
  }, []);
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(
      () => setElapsed(Math.round((Date.now() - startTime.current) / 1000)),
      500,
    );
    return () => clearInterval(timer);
  }, [recording]);
  useEffect(
    () => () => {
      if (recorder.current?.state === "recording") recorder.current.stop();
      streams.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      void audio.current?.close();
      if (sessionRef.current)
        void window.tadacut?.endSession(sessionRef.current.id);
    },
    [],
  );
  const loadSources = async () => {
    if (!window.tadacut) return;
    try {
      setSources(await window.tadacut.sources());
    } catch (e) {
      notify(String(e), true);
    }
  };
  const loadWindows = async () => {
    if (!window.tadacut) return;
    try {
      setWindows(await window.tadacut.windows());
    } catch (e) {
      notify(String(e), true);
    }
  };
  const start = async () => {
    try {
      const projectId = getState().project?.id;
      const automationId = sessionRef.current?.id;
      const owned: MediaStream[] = [];
      streams.current = owned;
      let capture: MediaStream;
      if (voiceOnly)
        capture = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
      else {
        if (window.tadacut && source) await window.tadacut.selectSource(source);
        capture = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 30 },
          audio: systemAudio,
        });
      }
      owned.push(capture);
      const tracks = [...capture.getVideoTracks()];
      if (!voiceOnly && mic)
        owned.push(await navigator.mediaDevices.getUserMedia({ audio: true }));
      const inputs = owned.filter((s) => s.getAudioTracks().length);
      if (inputs.length > 1) {
        audio.current = new AudioContext();
        const destination = audio.current.createMediaStreamDestination();
        inputs.forEach((s) =>
          audio.current!.createMediaStreamSource(s).connect(destination),
        );
        tracks.push(...destination.stream.getAudioTracks());
      } else if (inputs[0]) tracks.push(...inputs[0].getAudioTracks());
      const output = new MediaStream(tracks);
      streams.current = owned;
      const mime = voiceOnly
        ? ["audio/webm;codecs=opus", "audio/webm"].find((m) =>
            MediaRecorder.isTypeSupported(m),
          )
        : [
            "video/webm;codecs=vp9,opus",
            "video/webm;codecs=vp8,opus",
            "video/webm",
          ].find((m) => MediaRecorder.isTypeSupported(m));
      const mediaRecorder = new MediaRecorder(
        output,
        mime ? { mimeType: mime } : {},
      );
      recorder.current = mediaRecorder;
      const chunks: BlobPart[] = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      mediaRecorder.onstop = async () => {
        setRecording(false);
        owned.forEach((s) => s.getTracks().forEach((t) => t.stop()));
        await audio.current?.close();
        audio.current = null;
        if (video.current) video.current.srcObject = null;
        const file = new File(
          chunks,
          `${voiceOnly ? "旁白" : "应用录制"}-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.webm`,
          { type: mediaRecorder.mimeType },
        );
        if (projectId) {
          const [result] = await upload(projectId, [file]);
          const clicks =
            automationId && window.tadacut
              ? await window.tadacut
                  .clicks(automationId, startTime.current)
                  .catch(() => [])
              : [];
          if (clicks.length)
            await commit(
              [
                {
                  type: "asset.update",
                  assetId: result.asset.id,
                  patch: { clicks },
                },
              ],
              "保存会话点击记录",
              projectId,
            );
        }
        notify("录制已保存到项目素材");
      };
      capture.getVideoTracks().forEach(
        (track) =>
          (track.onended = () => {
            if (mediaRecorder.state === "recording") mediaRecorder.stop();
          }),
      );
      if (video.current && !voiceOnly) {
        video.current.srcObject = output;
        await video.current.play();
      }
      startTime.current = Date.now();
      setElapsed(0);
      setRecording(true);
      mediaRecorder.start(1000);
    } catch (e) {
      streams.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      notify(e instanceof Error ? e.message : String(e), true);
    }
  };
  const beginSession = async () => {
    if (!window.tadacut || !target) return;
    try {
      const session = await window.tadacut.startSession(target);
      setSession(session);
      notify("应用会话已开始，只操作你选择的窗口");
    } catch (e) {
      notify(String(e), true);
    }
  };
  const performType = async () => {
    if (!session || !window.tadacut) return;
    try {
      await window.tadacut.action(session.id, { type: "type", text });
      notify("文字已输入到目标应用");
    } catch (e) {
      notify(String(e), true);
    }
  };
  return (
    <div className="recording-workspace">
      <div className="story-header">
        <div>
          <span className="eyebrow">SHOW, THEN TELL</span>
          <h1>应用录制与操作</h1>
          <p>录下操作，也让 Agent 帮你把演示整理成故事。</p>
        </div>
        <span className={`quiet-badge ${window.tadacut ? "green" : ""}`}>
          {window.tadacut ? "桌面版" : "浏览器录制"}
        </span>
      </div>
      <div className="recording-grid">
        <section className="capture-card">
          <div className="section-title">
            <Monitor size={18} />
            <h3>录制画面与声音</h3>
          </div>
          <div className={`capture-preview ${recording ? "recording" : ""}`}>
            <video ref={video} muted playsInline />
            {!recording && (
              <div>
                <Monitor size={44} />
                <span>选一个画面，开始你的演示</span>
              </div>
            )}
            {recording && (
              <span className="record-time">
                <i />
                {String(Math.floor(elapsed / 60)).padStart(2, "0")}:
                {String(elapsed % 60).padStart(2, "0")}
              </span>
            )}
          </div>
          {window.tadacut && !voiceOnly && (
            <div className="capture-sources">
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="">刷新并选择录制画面</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                className="icon-button"
                title="刷新可录制窗口"
                onClick={() => void loadSources()}
              >
                <RefreshCw size={14} />
              </button>
            </div>
          )}
          <div className="capture-options">
            <label>
              <input
                type="checkbox"
                checked={voiceOnly}
                onChange={(e) => setVoiceOnly(e.target.checked)}
                disabled={recording}
              />
              <Mic size={13} />
              只录旁白
            </label>
            <label>
              <input
                type="checkbox"
                checked={mic}
                onChange={(e) => setMic(e.target.checked)}
                disabled={recording || voiceOnly}
              />
              <Mic size={13} />
              麦克风
            </label>
            <label>
              <input
                type="checkbox"
                checked={systemAudio}
                onChange={(e) => setSystemAudio(e.target.checked)}
                disabled={recording || voiceOnly}
              />
              <Monitor size={13} />
              系统声音
            </label>
          </div>
          <button
            className={
              recording ? "record-button stop" : "primary-button full-width"
            }
            disabled={
              !recording && Boolean(window.tadacut && !voiceOnly && !source)
            }
            onClick={() => {
              if (recording) recorder.current?.stop();
              else void start();
            }}
          >
            {recording ? (
              <>
                <Square size={14} fill="currentColor" />
                停止并保存
              </>
            ) : (
              <>
                <Circle size={14} fill="currentColor" />
                开始录制
              </>
            )}
          </button>
          <p className="small-description">
            录制结果保存到当前项目。系统声音取决于操作系统和当前权限。
          </p>
        </section>
        <section className="automation-card">
          <div className="section-title">
            <AppWindow size={18} />
            <h3>操作一个应用</h3>
          </div>
          <div className="automation-intro">
            <div className="automation-icon">
              <MousePointer2 size={28} />
            </div>
            <h3>从点击，到一段教程</h3>
            <p>
              选择目标窗口并开始会话。Agent
              使用截图、点击与键盘操作，始终限制在所选窗口。
            </p>
          </div>
          {window.tadacut ? (
            <>
              <div className="capture-sources">
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  disabled={Boolean(session)}
                >
                  <option value="">选择要操作的窗口</option>
                  {windows.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.title}
                    </option>
                  ))}
                </select>
                <button
                  className="icon-button"
                  title="刷新应用窗口"
                  disabled={Boolean(session)}
                  onClick={() => void loadWindows()}
                >
                  <RefreshCw size={14} />
                </button>
              </div>
              {session ? (
                <>
                  <div className="session-banner">
                    <ShieldCheck size={14} />
                    {session.title}
                    <button
                      title="结束应用会话"
                      onClick={() => {
                        void window.tadacut!.endSession(session.id);
                        setSession(null);
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                  <div className="form-field">
                    <input
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="输入到目标窗口的文字"
                    />
                    <button
                      className="secondary-button"
                      disabled={!text}
                      onClick={() => void performType()}
                    >
                      <Keyboard size={13} />
                      输入文字
                    </button>
                  </div>
                  <label className="form-field">
                    让 Agent 完成一个步骤
                    <textarea
                      className="field-textarea"
                      value={promptText}
                      onChange={(e) => setPromptText(e.target.value)}
                      placeholder="例如：打开新建项目面板，保持其他内容不变"
                    />
                  </label>
                  <button
                    className="primary-button full-width"
                    disabled={!promptText}
                    onClick={() => {
                      const pr = providers.find(
                        (pr) => pr.id === getState().providerId,
                      );
                      if (!pr?.model) {
                        notify("先配置支持图像理解的聊天模型", true);
                        return;
                      }
                      void startJob("computer-use", "应用操作", {
                        sessionId: session.id,
                        providerId: pr.id,
                        prompt: promptText,
                      });
                    }}
                  >
                    <Sparkles size={14} />
                    在授权窗口中执行
                  </button>
                </>
              ) : (
                <button
                  className="secondary-button full-width"
                  disabled={!target}
                  onClick={() => void beginSession()}
                >
                  <ShieldCheck size={14} />
                  开始应用会话
                </button>
              )}
              <div className="permission-indicators">
                <span>
                  <i className={permissions?.screen ? "ready" : ""} />
                  屏幕录制
                </span>
                <span>
                  <i className={permissions?.accessibility ? "ready" : ""} />
                  辅助功能
                </span>
              </div>
            </>
          ) : (
            <div className="native-required">
              <LaptopIcon />
              <span>应用操作在 TadaCut 桌面版中使用</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
function LaptopIcon() {
  return <Monitor size={16} />;
}
