/**
 * Agora mode: full-duplex voice over Agora RTC. The Agora Conversational AI agent joins the same
 * channel and handles ASR, turn detection, barge-in, and Murf Falcon TTS; the brain is our
 * custom LLM endpoint (tools + RAG). Echo cancellation lets the tech interrupt naturally.
 */
import AgoraRTC, { type IAgoraRTCClient, type IMicrophoneAudioTrack, type IRemoteAudioTrack } from "agora-rtc-sdk-ng";

AgoraRTC.setLogLevel(3);

export class AgoraVoice {
  private client: IAgoraRTCClient | null = null;
  private mic: IMicrophoneAudioTrack | null = null;
  private remote: IRemoteAudioTrack | null = null;
  private timer: any = null;
  channel = "";

  constructor(private onLevels: (mic: number, agent: number) => void) {}

  async start() {
    const r = await fetch("/api/session/agora/start", { method: "POST" });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Failed to start Agora agent");
    this.channel = j.channel;

    const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
    this.client = client;
    client.on("user-published", async (user, mediaType) => {
      await client.subscribe(user, mediaType);
      if (mediaType === "audio" && user.audioTrack) {
        this.remote = user.audioTrack;
        this.remote.play();
      }
    });
    client.on("user-unpublished", (_u, mediaType) => {
      if (mediaType === "audio") this.remote = null;
    });

    await client.join(j.appId, j.channel, j.token, j.uid);
    this.mic = await AgoraRTC.createMicrophoneAudioTrack({ AEC: true, ANS: true, AGC: true });
    await client.publish([this.mic]);

    this.timer = setInterval(() => {
      this.onLevels(this.mic?.muted ? 0 : (this.mic?.getVolumeLevel() ?? 0), this.remote?.getVolumeLevel() ?? 0);
    }, 80);
    return j;
  }

  async setMuted(m: boolean) {
    await this.mic?.setMuted(m);
  }

  async stop() {
    clearInterval(this.timer);
    this.mic?.close();
    this.mic = null;
    this.remote = null;
    await this.client?.leave().catch(() => {});
    this.client = null;
    await fetch("/api/session/agora/stop", { method: "POST" }).catch(() => {});
    this.onLevels(0, 0);
  }
}
