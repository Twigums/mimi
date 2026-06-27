export interface TextAlivePlayerOptions {
  app: {
    token: string;
    appAuthor?: string;
    appName?: string;
  };
  mediaElement?: HTMLElement | null;
  mediaBannerPosition?: string;
}

export interface TextAliveWord {
  firstChar: TextAliveChar | null;
  lastChar: TextAliveChar | null;
}

export interface TextAliveChar {
  text: string;
  startTime: number;
  endTime: number;
  next: TextAliveChar | null;
  // The word this character belongs to (TextAlive Phrase → Word → Char). Used to
  // shine a whole word once all its mapped lyric notes are hit.
  parent: TextAliveWord | null;
}

export interface TextAlivePhrase {
  startTime: number;
  endTime: number;
  firstChar: TextAliveChar | null;
  text: string;
  next: TextAlivePhrase | null;
  /** Concurrent overlay layer (e.g. staff chorus lines under lead vocal). */
  overlay?: boolean;
}

export interface TextAliveVideo {
  duration: number;
  charCount: number;
  firstPhrase: TextAlivePhrase | null;
  findPhrase(time: number): TextAlivePhrase | null;
  /** All phrases active at `time` (for stacked storyboard display). */
  findActivePhrases?(time: number): TextAlivePhrase[];
  findChar(time: number): TextAliveChar | null;
}

interface TextAliveTimer {
  position: number;
}

export interface TextAliveBeat {
  startTime: number;
  endTime: number;
  // 0..1 progress through this beat at the given song position.
  progress(time: number): number;
}

export interface TextAliveChorusSegment {
  startTime: number;
  endTime: number;
}

export interface TextAliveValenceArousal {
  v: number;
  a: number;
}

export interface TextAlivePlayer {
  timer: TextAliveTimer;
  video: TextAliveVideo | null;
  data: { song: { length: number; name: string; artist: { name: string } } | null };
  isPlaying: boolean;
  volume: number;
  addListener(l: Partial<TextAliveListener>): void;
  createFromSongUrl(url: string, options?: { video?: { beatId?: number; chordId?: number; repetitiveSegmentId?: number; lyricId?: number; lyricDiffId?: number } }): Promise<void>;
  requestPlay(): void;
  requestPause(): void;
  requestStop(): void;
  requestMediaSeek(ms: number): void;
  // Song-map analysis accessors used by the reactive storyboard directives.
  getVocalAmplitude(time: number): number;
  getMaxVocalAmplitude(): number;
  getValenceArousal(time: number): TextAliveValenceArousal;
  findBeat(time: number): TextAliveBeat | null;
  getChoruses(): TextAliveChorusSegment[];
}

interface TextAliveListener {
  onAppReady(app: { managed: boolean; songUrl: string | null }): void;
  onVideoReady(video: TextAliveVideo): void;
  onTimerReady(): void;
  onPlay(): void;
  onPause(): void;
  onStop(): void;
  onTimeUpdate(pos: number): void;
  onThrottledTimeUpdate(pos: number): void;
}

declare global {
  interface Window {
    TextAliveApp?: {
      Player: new (opts: TextAlivePlayerOptions) => TextAlivePlayer;
    };
  }
}