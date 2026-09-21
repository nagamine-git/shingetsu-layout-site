export type BgmPreset = "off" | "eclipse" | "still" | "orbit";
export type KeySound = "off" | "felt" | "tactile" | "glass";

export interface AudioSettings {
  bgm: BgmPreset;
  se: KeySound;
  bgmVolume: number;
  seVolume: number;
}

export interface AudioSnapshot extends AudioSettings {
  enabled: boolean;
  failed: boolean;
}

type AudioContextConstructor = new () => AudioContext;

interface AudioWindow extends Window {
  AudioContext?: AudioContextConstructor;
  webkitAudioContext?: AudioContextConstructor;
}

const STORAGE_KEY = "shingetsu-training-audio-v1";
const DEFAULT_SETTINGS: AudioSettings = {
  bgm: "off",
  se: "off",
  bgmVolume: 0.32,
  seVolume: 0.45,
};
const BGM_PRESETS = new Set<BgmPreset>(["off", "eclipse", "still", "orbit"]);
const KEY_SOUNDS = new Set<KeySound>(["off", "felt", "tactile", "glass"]);
const MAX_BGM_SOURCES = 28;
const MAX_SE_SOURCES = 16;
const SCHEDULE_AHEAD_SECONDS = 0.35;
const SCHEDULER_INTERVAL_MS = 120;

function clampVolume(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

function midi(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

function loadSettings(): AudioSettings {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return { ...DEFAULT_SETTINGS };
    const value: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
    if (!value || typeof value !== "object") return { ...DEFAULT_SETTINGS };
    const stored = value as Partial<AudioSettings>;
    return {
      bgm:
        typeof stored.bgm === "string" &&
        BGM_PRESETS.has(stored.bgm as BgmPreset)
          ? (stored.bgm as BgmPreset)
          : DEFAULT_SETTINGS.bgm,
      se:
        typeof stored.se === "string" && KEY_SOUNDS.has(stored.se as KeySound)
          ? (stored.se as KeySound)
          : DEFAULT_SETTINGS.se,
      bgmVolume:
        typeof stored.bgmVolume === "number"
          ? clampVolume(stored.bgmVolume, DEFAULT_SETTINGS.bgmVolume)
          : DEFAULT_SETTINGS.bgmVolume,
      seVolume:
        typeof stored.seVolume === "number"
          ? clampVolume(stored.seVolume, DEFAULT_SETTINGS.seVolume)
          : DEFAULT_SETTINGS.seVolume,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export class TrainingAudio {
  private settingsValue: AudioSettings = loadSettings();
  private enabledValue = false;
  private failedValue = false;
  private active = false;
  private disposed = false;
  private activationGeneration = 0;
  private context?: AudioContext;
  private bgmBus?: GainNode;
  private seBus?: GainNode;
  private noiseBuffer?: AudioBuffer;
  private bgmSources = new Set<AudioScheduledSourceNode>();
  private seSources = new Set<AudioScheduledSourceNode>();
  private sourceCleanup = new Map<AudioScheduledSourceNode, () => void>();
  private bgmTimer?: ReturnType<typeof setTimeout>;
  private playingPreset?: BgmPreset;
  private nextStepTime = 0;
  private step = 0;

  public constructor(private readonly onStatus?: (status: string) => void) {
    if (typeof document !== "undefined") {
      document.addEventListener(
        "visibilitychange",
        this.handleVisibilityChange,
      );
    }
  }

  public get settings(): AudioSettings {
    return { ...this.settingsValue };
  }

  public get enabled(): boolean {
    return this.enabledValue;
  }

  public snapshot(): AudioSnapshot {
    return {
      ...this.settingsValue,
      enabled: this.enabledValue && this.context?.state === "running",
      failed: this.failedValue,
    };
  }

  public configure(partial: Partial<AudioSettings>): void {
    if (this.disposed) return;
    const previousBgm = this.settingsValue.bgm;
    const next = { ...this.settingsValue };
    if (
      typeof partial.bgm === "string" &&
      BGM_PRESETS.has(partial.bgm as BgmPreset)
    ) {
      next.bgm = partial.bgm as BgmPreset;
    }
    if (
      typeof partial.se === "string" &&
      KEY_SOUNDS.has(partial.se as KeySound)
    ) {
      next.se = partial.se as KeySound;
    }
    if (typeof partial.bgmVolume === "number") {
      next.bgmVolume = clampVolume(partial.bgmVolume, next.bgmVolume);
    }
    if (typeof partial.seVolume === "number") {
      next.seVolume = clampVolume(partial.seVolume, next.seVolume);
    }
    this.settingsValue = next;
    this.persistSettings();
    this.applyVolumes();

    if (previousBgm !== next.bgm) {
      this.stopBgm(true);
      this.startBgmIfReady();
    }
  }

  public async enable(): Promise<boolean> {
    if (this.disposed) return false;
    const activation = ++this.activationGeneration;
    if (typeof window === "undefined" || typeof document === "undefined") {
      this.markFailure("unsupported");
      return false;
    }
    if (document.visibilityState === "hidden") {
      this.emitStatus("suspended");
      return false;
    }

    try {
      if (!this.context) this.createContext();
      const context = this.context;
      if (!context || context.state === "closed") {
        this.markFailure("unsupported");
        return false;
      }
      if (context.state !== "running") await context.resume();
      if (activation !== this.activationGeneration || this.disposed) {
        return false;
      }
      if (document.hidden) {
        this.handleVisibilityChange();
        return false;
      }
      if (context.state !== "running") {
        this.markFailure("blocked");
        return false;
      }
      this.enabledValue = true;
      this.failedValue = false;
      if (!this.applyVolumes()) return false;
      this.startBgmIfReady();
      this.emitStatus("enabled");
      return true;
    } catch {
      if (activation === this.activationGeneration && !this.disposed)
        this.markFailure("failed");
      return false;
    }
  }

  public setActive(active: boolean): void {
    if (this.disposed || this.active === active) return;
    this.active = active;
    if (active) this.startBgmIfReady();
    else this.stopBgm(false);
  }

  public key(correct = true): void {
    if (!this.canPlay() || this.settingsValue.se === "off") return;
    try {
      const now = this.context!.currentTime;
      if (this.settingsValue.se === "felt") this.playFelt(now, correct);
      else if (this.settingsValue.se === "tactile")
        this.playTactile(now, correct);
      else this.playGlass(now, correct);
    } catch {
      this.markFailure("failed");
    }
  }

  public celebrate(): void {
    if (!this.canPlay() || this.settingsValue.se === "off") return;
    try {
      const now = this.context!.currentTime;
      const notes =
        this.settingsValue.se === "felt" ? [60, 64, 67] : [72, 76, 79];
      notes.forEach((note, index): void => {
        this.scheduleTone({
          time: now + index * 0.09,
          frequency: midi(note),
          duration: 0.34,
          level: 0.075,
          type: this.settingsValue.se === "glass" ? "sine" : "triangle",
          attack: 0.008,
          release: 0.28,
          destination: this.seBus!,
          sources: this.seSources,
          limit: MAX_SE_SOURCES,
        });
      });
    } catch {
      this.markFailure("failed");
    }
  }

  public mute(): void {
    if (this.disposed) return;
    this.activationGeneration += 1;
    this.enabledValue = false;
    this.stopBgm(true);
    this.stopSources(this.seSources);
    const context = this.context;
    if (context && context.state === "running") {
      try {
        void context.suspend().catch((): void => undefined);
      } catch {}
    }
    this.emitStatus("muted");
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.activationGeneration += 1;
    this.enabledValue = false;
    this.active = false;
    if (typeof document !== "undefined") {
      document.removeEventListener(
        "visibilitychange",
        this.handleVisibilityChange,
      );
    }
    this.stopBgm(true);
    this.stopSources(this.seSources);
    const context = this.context;
    this.context = undefined;
    context?.removeEventListener("statechange", this.handleContextStateChange);
    this.bgmBus = undefined;
    this.seBus = undefined;
    this.noiseBuffer = undefined;
    if (context && context.state !== "closed") {
      try {
        void context.close().catch((): void => undefined);
      } catch {}
    }
  }

  private readonly handleVisibilityChange = (): void => {
    if (
      this.disposed ||
      typeof document === "undefined" ||
      document.visibilityState !== "hidden"
    )
      return;
    this.activationGeneration += 1;
    this.enabledValue = false;
    this.stopBgm(false);
    this.stopSources(this.seSources);
    this.emitStatus("suspended");
    const suspension = this.activationGeneration;
    const context = this.context;
    if (context && context.state === "running") {
      try {
        void context.suspend().catch((): void => {
          if (suspension === this.activationGeneration && !this.disposed)
            this.markFailure("failed");
        });
      } catch {
        this.markFailure("failed");
      }
    }
  };

  private readonly handleContextStateChange = (): void => {
    if (
      this.disposed ||
      !this.enabledValue ||
      this.context?.state === "running"
    )
      return;
    this.activationGeneration += 1;
    this.enabledValue = false;
    this.stopBgm(false);
    this.stopSources(this.seSources);
    this.emitStatus("suspended");
  };

  private createContext(): void {
    const audioWindow = window as AudioWindow;
    const Constructor =
      audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
    if (!Constructor) return;
    const context = new Constructor();
    const bgmBus = context.createGain();
    const seBus = context.createGain();
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.16;
    bgmBus.connect(compressor);
    seBus.connect(compressor);
    compressor.connect(context.destination);
    this.context = context;
    context.addEventListener("statechange", this.handleContextStateChange);
    this.bgmBus = bgmBus;
    this.seBus = seBus;
  }

  private canPlay(): boolean {
    return Boolean(
      !this.disposed &&
      this.enabledValue &&
      this.context?.state === "running" &&
      this.seBus &&
      (typeof document === "undefined" ||
        document.visibilityState !== "hidden"),
    );
  }

  private startBgmIfReady(): void {
    if (
      this.disposed ||
      !this.enabledValue ||
      !this.active ||
      this.settingsValue.bgm === "off" ||
      !this.context ||
      !this.bgmBus ||
      this.context.state !== "running" ||
      (typeof document !== "undefined" && document.visibilityState === "hidden")
    )
      return;
    if (
      this.playingPreset === this.settingsValue.bgm &&
      this.bgmTimer !== undefined
    )
      return;
    if (this.playingPreset !== this.settingsValue.bgm) this.stopBgm(true);
    this.playingPreset = this.settingsValue.bgm;
    if (this.nextStepTime < this.context.currentTime)
      this.nextStepTime = this.context.currentTime + 0.04;
    this.scheduleBgm();
  }

  private scheduleBgm(): void {
    this.clearBgmTimer();
    const context = this.context;
    const preset = this.playingPreset;
    if (!context || !preset || preset === "off" || context.state !== "running")
      return;
    try {
      if (this.nextStepTime < context.currentTime - SCHEDULE_AHEAD_SECONDS) {
        const skipped = Math.ceil(
          (context.currentTime - this.nextStepTime) / this.stepDuration(preset),
        );
        this.step += skipped;
        this.nextStepTime = context.currentTime + 0.04;
      }
      while (this.nextStepTime < context.currentTime + SCHEDULE_AHEAD_SECONDS) {
        if (preset === "eclipse")
          this.scheduleEclipseStep(this.step, this.nextStepTime);
        else if (preset === "still")
          this.scheduleStillStep(this.step, this.nextStepTime);
        else this.scheduleOrbitStep(this.step, this.nextStepTime);
        this.step += 1;
        this.nextStepTime += this.stepDuration(preset);
      }
      this.bgmTimer = setTimeout(
        (): void => this.scheduleBgm(),
        SCHEDULER_INTERVAL_MS,
      );
    } catch {
      this.markFailure("failed");
    }
  }

  private stepDuration(preset: Exclude<BgmPreset, "off">): number {
    if (preset === "eclipse") return 60 / 84 / 2;
    if (preset === "still") return 60 / 64;
    return 60 / 112 / 2;
  }

  private scheduleEclipseStep(step: number, time: number): void {
    const roots = [38, 38, 34, 36];
    const root = roots[Math.floor(step / 8) % roots.length];
    if (step % 8 === 0) {
      [root, root + 7, root + 15].forEach((note, index): void => {
        this.scheduleTone({
          time,
          frequency: midi(note),
          duration: 2.45,
          level: index === 0 ? 0.07 : 0.04,
          type: index === 0 ? "sawtooth" : "triangle",
          attack: 0.18,
          release: 1.2,
          filter: 820 + index * 210,
          destination: this.bgmBus!,
          sources: this.bgmSources,
          limit: MAX_BGM_SOURCES,
        });
      });
    }
    if (step % 4 === 0) {
      this.scheduleTone({
        time,
        frequency: midi(root - 12),
        duration: 0.42,
        level: 0.12,
        type: "sine",
        attack: 0.008,
        release: 0.34,
        destination: this.bgmBus!,
        sources: this.bgmSources,
        limit: MAX_BGM_SOURCES,
      });
      this.scheduleNoise(
        time,
        0.11,
        0.085,
        110,
        this.bgmSources,
        MAX_BGM_SOURCES,
      );
    }
    if (step % 8 === 4) {
      this.scheduleNoise(
        time,
        0.12,
        0.045,
        1600,
        this.bgmSources,
        MAX_BGM_SOURCES,
      );
    }
    if (step % 8 === 6) {
      this.scheduleTone({
        time,
        frequency: midi(root + 19),
        duration: 0.28,
        level: 0.045,
        type: "square",
        attack: 0.015,
        release: 0.21,
        filter: 1250,
        destination: this.bgmBus!,
        sources: this.bgmSources,
        limit: MAX_BGM_SOURCES,
      });
    }
  }

  private scheduleStillStep(step: number, time: number): void {
    const chords = [
      [48, 55, 59],
      [45, 52, 57],
      [41, 48, 55],
      [43, 50, 57],
    ];
    const chord = chords[Math.floor(step / 4) % chords.length];
    if (step % 4 === 0) {
      chord.forEach((note, index): void => {
        this.scheduleTone({
          time,
          frequency: midi(note),
          duration: 4.4,
          level: 0.032,
          type: index === 1 ? "sine" : "triangle",
          attack: 0.75,
          release: 1.7,
          detune: index === 2 ? 4 : -3,
          filter: 1050,
          destination: this.bgmBus!,
          sources: this.bgmSources,
          limit: MAX_BGM_SOURCES,
        });
      });
    }
    if (step % 2 === 1) {
      const note = chord[(step >> 1) % chord.length] + 24;
      this.scheduleTone({
        time: time + 0.16,
        frequency: midi(note),
        duration: 1.15,
        level: 0.023,
        type: "sine",
        attack: 0.08,
        release: 0.95,
        destination: this.bgmBus!,
        sources: this.bgmSources,
        limit: MAX_BGM_SOURCES,
      });
    }
  }

  private scheduleOrbitStep(step: number, time: number): void {
    const sequence = [45, 52, 57, 52, 48, 55, 60, 55];
    const note = sequence[step % sequence.length];
    this.scheduleTone({
      time,
      frequency: midi(note),
      duration: 0.2,
      level: step % 4 === 0 ? 0.075 : 0.045,
      type: "square",
      attack: 0.006,
      release: 0.16,
      filter: step % 2 === 0 ? 1300 : 920,
      destination: this.bgmBus!,
      sources: this.bgmSources,
      limit: MAX_BGM_SOURCES,
    });
    if (step % 4 === 0) {
      this.scheduleTone({
        time,
        frequency: midi(note - 24),
        duration: 0.3,
        level: 0.07,
        type: "sine",
        attack: 0.008,
        release: 0.24,
        destination: this.bgmBus!,
        sources: this.bgmSources,
        limit: MAX_BGM_SOURCES,
      });
    }
    if (step % 2 === 1)
      this.scheduleNoise(
        time,
        0.04,
        0.018,
        4200,
        this.bgmSources,
        MAX_BGM_SOURCES,
      );
  }

  private playFelt(time: number, correct: boolean): void {
    this.scheduleTone({
      time,
      frequency: midi(correct ? 57 : 45),
      duration: 0.12,
      level: correct ? 0.11 : 0.075,
      type: "triangle",
      attack: 0.003,
      release: 0.1,
      filter: correct ? 780 : 430,
      destination: this.seBus!,
      sources: this.seSources,
      limit: MAX_SE_SOURCES,
    });
  }

  private playTactile(time: number, correct: boolean): void {
    this.scheduleNoise(
      time,
      correct ? 0.035 : 0.07,
      correct ? 0.12 : 0.08,
      correct ? 2600 : 650,
      this.seSources,
      MAX_SE_SOURCES,
    );
    this.scheduleTone({
      time,
      frequency: correct ? 165 : 92,
      duration: 0.055,
      level: 0.075,
      type: "square",
      attack: 0.001,
      release: 0.045,
      filter: correct ? 1800 : 520,
      destination: this.seBus!,
      sources: this.seSources,
      limit: MAX_SE_SOURCES,
    });
  }

  private playGlass(time: number, correct: boolean): void {
    const base = correct ? midi(81) : midi(63);
    [1, 2.01].forEach((multiple, index): void => {
      this.scheduleTone({
        time,
        frequency: base * multiple,
        duration: index === 0 ? 0.22 : 0.13,
        level: index === 0 ? 0.07 : 0.025,
        type: "sine",
        attack: 0.002,
        release: index === 0 ? 0.2 : 0.11,
        destination: this.seBus!,
        sources: this.seSources,
        limit: MAX_SE_SOURCES,
      });
    });
  }

  private scheduleTone(options: {
    time: number;
    frequency: number;
    duration: number;
    level: number;
    type: OscillatorType;
    attack: number;
    release: number;
    destination: AudioNode;
    sources: Set<AudioScheduledSourceNode>;
    limit: number;
    filter?: number;
    detune?: number;
  }): void {
    const context = this.context;
    if (!context || options.sources.size >= options.limit) return;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = options.type;
    oscillator.frequency.setValueAtTime(options.frequency, options.time);
    oscillator.detune.setValueAtTime(options.detune ?? 0, options.time);
    envelope.gain.setValueAtTime(0.0001, options.time);
    envelope.gain.linearRampToValueAtTime(
      options.level,
      options.time + options.attack,
    );
    envelope.gain.setValueAtTime(
      options.level,
      Math.max(
        options.time + options.attack,
        options.time + options.duration - options.release,
      ),
    );
    envelope.gain.exponentialRampToValueAtTime(
      0.0001,
      options.time + options.duration,
    );

    const nodes: AudioNode[] = [oscillator, envelope];
    if (options.filter) {
      const filter = context.createBiquadFilter();
      nodes.push(filter);
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(options.filter, options.time);
      filter.Q.value = 0.7;
      oscillator.connect(filter);
      filter.connect(envelope);
    } else {
      oscillator.connect(envelope);
    }
    envelope.connect(options.destination);
    this.trackSource(oscillator, options.sources, nodes);
    oscillator.start(options.time);
    oscillator.stop(options.time + options.duration + 0.02);
  }

  private scheduleNoise(
    time: number,
    duration: number,
    level: number,
    filterFrequency: number,
    sources: Set<AudioScheduledSourceNode>,
    limit: number,
  ): void {
    const context = this.context;
    if (!context || sources.size >= limit) return;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    source.buffer = this.getNoiseBuffer();
    filter.type = filterFrequency < 500 ? "lowpass" : "bandpass";
    filter.frequency.setValueAtTime(filterFrequency, time);
    filter.Q.value = filterFrequency < 500 ? 0.8 : 1.4;
    envelope.gain.setValueAtTime(level, time);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(sources === this.seSources ? this.seBus! : this.bgmBus!);
    this.trackSource(source, sources, [source, filter, envelope]);
    source.start(time);
    source.stop(time + duration + 0.01);
  }

  private getNoiseBuffer(): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const context = this.context!;
    const length = Math.max(1, Math.floor(context.sampleRate * 0.16));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.55 + white * 0.45;
      data[index] = previous;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  private trackSource(
    source: AudioScheduledSourceNode,
    sources: Set<AudioScheduledSourceNode>,
    nodes: AudioNode[],
  ): void {
    sources.add(source);
    const cleanup = (): void => {
      sources.delete(source);
      this.sourceCleanup.delete(source);
      source.removeEventListener("ended", cleanup);
      for (const node of nodes) {
        try {
          node.disconnect();
        } catch {}
      }
    };
    this.sourceCleanup.set(source, cleanup);
    source.addEventListener("ended", cleanup, { once: true });
  }

  private stopBgm(resetPhase: boolean): void {
    this.clearBgmTimer();
    this.stopSources(this.bgmSources);
    if (resetPhase) {
      this.playingPreset = undefined;
      this.step = 0;
      this.nextStepTime = 0;
    }
  }

  private clearBgmTimer(): void {
    if (this.bgmTimer === undefined) return;
    clearTimeout(this.bgmTimer);
    this.bgmTimer = undefined;
  }

  private stopSources(sources: Set<AudioScheduledSourceNode>): void {
    for (const source of sources) {
      try {
        source.stop();
      } catch {}
      this.sourceCleanup.get(source)?.();
    }
    sources.clear();
  }

  private applyVolumes(): boolean {
    const context = this.context;
    if (!context) return true;
    try {
      this.bgmBus?.gain.setTargetAtTime(
        this.settingsValue.bgmVolume,
        context.currentTime,
        0.02,
      );
      this.seBus?.gain.setTargetAtTime(
        this.settingsValue.seVolume,
        context.currentTime,
        0.01,
      );
      return true;
    } catch {
      this.markFailure("failed");
      return false;
    }
  }

  private persistSettings(): void {
    try {
      const storage = globalThis.localStorage;
      if (!storage) return;
      storage.setItem(STORAGE_KEY, JSON.stringify(this.settingsValue));
    } catch {
      this.emitStatus("storage-unavailable");
    }
  }

  private markFailure(status: string): void {
    this.activationGeneration += 1;
    this.failedValue = true;
    this.enabledValue = false;
    this.stopBgm(true);
    this.stopSources(this.seSources);
    this.emitStatus(status);
  }

  private emitStatus(status: string): void {
    try {
      this.onStatus?.(status);
    } catch {}
  }
}
