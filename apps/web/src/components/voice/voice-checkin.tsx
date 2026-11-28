'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Loader2,
  MessageSquareHeart,
  Mic,
  MicOff,
  Send,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  cleanSpokenTranscript,
  isWhisperHallucination,
} from '@/lib/voice/transcript-cleaner';

interface VoiceCheckinProps {
  patientId?: string;
  locale: 'en' | 'kn' | 'hi';
  isSynthetic?: boolean;
  onRecorded: () => void;
}

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  redFlag?: boolean;
  responderSource?: string;
}

type VoiceEnginePreference = 'auto' | 'whisper_ai' | 'live_speech';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const INITIAL_GREETING: Record<'en' | 'kn' | 'hi', string> = {
  en: 'Hello! I am Sachet, your Wispr-powered voice companion. Tap Speak (or type below) to say hello, ask how your vitals look, or tell me about any discomfort or question.',
  kn: 'ನಮಸ್ಕಾರ! ನಾನು ನಿಮ್ಮ ಸಚೇತ್ ಧ್ವನಿ ಸಂಗಾತಿ. ಮಾತನಾಡಿ ಅಥವಾ ಕೆಳಗೆ ಟೈಪ್ ಮಾಡಿ — ಹಲೋ ಹೇಳಿ, ನಿಮ್ಮ ಆರೋಗ್ಯ ಮಾಹಿತಿ ಕೇಳಿ, ಅಥವಾ ಯಾವುದೇ ಸಮಸ್ಯೆಯನ್ನು ತಿಳಿಸಿ.',
  hi: 'नमस्ते! मैं सचेत, आपका लाइव वॉयस साथी हूँ। बात करने के लिए Speak दबाएं या नीचे लिखें — हैलो कहें, अपनी रीडिंग पूछें, या कोई भी परेशानी बताएं।',
};

const BAR_INDICES = Array.from({ length: 16 }, (_, i) => i);

function resolveSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

function selectBestSpeechVoice(langTag: string): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  const langPrefix = langTag.split('-')[0]?.toLowerCase() ?? 'en';
  const candidates = voices.filter((v) => v.lang.toLowerCase().startsWith(langPrefix));
  const pool = candidates.length > 0 ? candidates : voices;

  return (
    pool.find((v) => /natural|neural|google|microsoft.*online/i.test(v.name) && v.lang === langTag) ??
    pool.find((v) => /natural|neural|google/i.test(v.name)) ??
    pool.find((v) => v.lang === langTag) ??
    pool[0] ??
    null
  );
}

function mapSpeechErrorMessage(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone permission was blocked. Allow mic access in browser settings or type below.';
    case 'no-speech':
      return 'No speech was detected. Tap Speak again or switch to Whisper AI mode.';
    case 'audio-capture':
      return 'No working microphone found on this device. You can type below.';
    case 'aborted':
      return '';
    default:
      return `Live speech paused (${code}). Switched or ready to retry.`;
  }
}

async function decodeBlobToMono16k(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AudioCtx({ sampleRate: 16000 });
  try {
    const decoded = await audioCtx.decodeAudioData(arrayBuffer);
    const channelCount = Math.max(1, decoded.numberOfChannels);
    if (channelCount === 1) {
      return new Float32Array(decoded.getChannelData(0));
    }
    const mono = new Float32Array(decoded.length);
    for (let ch = 0; ch < channelCount; ch += 1) {
      const data = decoded.getChannelData(ch);
      for (let i = 0; i < decoded.length; i += 1) {
        mono[i] = (mono[i] ?? 0) + (data[i] ?? 0) / channelCount;
      }
    }
    return mono;
  } finally {
    await audioCtx.close().catch(() => { });
  }
}

export function VoiceCheckinCompanion({
  patientId,
  locale,
  isSynthetic = false,
  onRecorded,
}: VoiceCheckinProps) {
  const [messages, setMessages] = useState<ChatTurn[]>([
    { id: 'welcome', role: 'assistant', text: INITIAL_GREETING[locale] },
  ]);
  const [transcript, setTranscript] = useState('');
  const [enginePref, setEnginePref] = useState<VoiceEnginePreference>('auto');
  const [serverWhisperAvailable, setServerWhisperAvailable] = useState(false);
  const [whisperProviderLabel, setWhisperProviderLabel] = useState(
    'Open-Source Whisper (On-Device)',
  );
  const [modelProgress, setModelProgress] = useState<number | null>(null);
  const [transcribingAudio, setTranscribingAudio] = useState(false);

  const [listening, setListening] = useState(false);
  const [activeModeLabel, setActiveModeLabel] = useState<string | null>(null);
  const [audioLevels, setAudioLevels] = useState<number[]>(() => BAR_INDICES.map(() => 0.14));
  const [speaking, setSpeaking] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [handsFreeMode, setHandsFreeMode] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceHint, setVoiceHint] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const capturedFinalRef = useRef<string>('');
  const latestInterimRef = useRef<string>('');
  const speechSilenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const workerPendingRef = useRef<
    Map<string, { resolve: (text: string) => void; reject: (err: Error) => void }>
  >(new Map());

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const vadCtxRef = useRef<AudioContext | null>(null);
  const vadRafRef = useRef<number | null>(null);

  const manualStopRef = useRef(false);
  const handsFreeRef = useRef(false);
  const startListeningRef = useRef<() => void>(() => { });
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    handsFreeRef.current = handsFreeMode;
  }, [handsFreeMode]);

  useEffect(() => {
    let active = true;
    fetch('/api/v1/voice/transcribe')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { serverWhisperAvailable?: boolean; providerLabel?: string } | null) => {
        if (!active || !data) return;
        setServerWhisperAvailable(Boolean(data.serverWhisperAvailable));
        if (data.providerLabel) setWhisperProviderLabel(data.providerLabel);
      })
      .catch(() => { });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setMessages((prev) =>
      prev.length === 1 && prev[0]?.id === 'welcome'
        ? [{ id: 'welcome', role: 'assistant', text: INITIAL_GREETING[locale] }]
        : prev,
    );
  }, [locale]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages.length]);

  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_OPEN_LLM_VTUBER_WS;
    if (!wsUrl) return;
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onopen = () => setWsConnected(true);
      ws.onclose = () => setWsConnected(false);
    } catch {
      setWsConnected(false);
    }
    return () => {
      wsRef.current?.close();
    };
  }, []);

  function cleanupAudioCapture() {
    if (speechSilenceTimerRef.current) {
      clearTimeout(speechSilenceTimerRef.current);
      speechSilenceTimerRef.current = null;
    }
    if (vadRafRef.current !== null) {
      cancelAnimationFrame(vadRafRef.current);
      vadRafRef.current = null;
    }
    if (vadCtxRef.current) {
      void vadCtxRef.current.close().catch(() => { });
      vadCtxRef.current = null;
    }
    if (mediaStreamRef.current) {
      for (const t of mediaStreamRef.current.getTracks()) t.stop();
      mediaStreamRef.current = null;
    }
    setAudioLevels(BAR_INDICES.map(() => 0.14));
  }

  useEffect(() => {
    return () => {
      manualStopRef.current = true;
      handsFreeRef.current = false;
      try {
        recognitionRef.current?.abort();
      } catch {
        // Ignore
      }
      if (mediaRecorderRef.current?.state === 'recording') {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          // Ignore
        }
      }
      cleanupAudioCapture();
      workerRef.current?.terminate();
      workerRef.current = null;
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  function getOrCreateWhisperWorker(): Worker {
    if (workerRef.current) return workerRef.current;
    const worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.addEventListener('message', (event: MessageEvent) => {
      const msg = event.data as {
        type: string;
        id?: string;
        text?: string;
        progress?: number;
        error?: string;
      };
      if (msg.type === 'progress' && typeof msg.progress === 'number') {
        setModelProgress(msg.progress);
      } else if (msg.type === 'ready') {
        setModelProgress(null);
      } else if (msg.type === 'transcript' && msg.id) {
        const pending = workerPendingRef.current.get(msg.id);
        if (pending) {
          workerPendingRef.current.delete(msg.id);
          pending.resolve(msg.text ?? '');
        }
      } else if (msg.type === 'error' && msg.id) {
        const pending = workerPendingRef.current.get(msg.id);
        if (pending) {
          workerPendingRef.current.delete(msg.id);
          pending.reject(new Error(msg.error || 'Whisper worker failed'));
        }
      }
    });
    workerRef.current = worker;
    return worker;
  }

  function bargeInStop() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  }

  function speakText(text: string, onSpeechDone?: () => void) {
    if (!autoSpeak || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      onSpeechDone?.();
      return;
    }
    window.speechSynthesis.cancel();
    const langTag = locale === 'kn' ? 'kn-IN' : locale === 'hi' ? 'hi-IN' : 'en-IN';
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = langTag;
    const chosenVoice = selectBestSpeechVoice(langTag);
    if (chosenVoice) utter.voice = chosenVoice;
    utter.rate = 0.96;
    utter.onstart = () => setSpeaking(true);
    utter.onend = () => {
      setSpeaking(false);
      onSpeechDone?.();
    };
    utter.onerror = () => {
      setSpeaking(false);
    };
    window.speechSynthesis.speak(utter);
  }

  async function transcribeAudioWithWhisper(blob: Blob) {
    setTranscribingAudio(true);
    setVoiceHint('Cleaning speech with open-source Whisper...');

    try {
      // 1. Try fast free-tier Groq / local Whisper server endpoint first if configured
      if (serverWhisperAvailable) {
        const fd = new FormData();
        fd.append('audio', blob, 'voice.webm');
        fd.append('locale', locale);
        const srvRes = await fetch('/api/v1/voice/transcribe', { method: 'POST', body: fd });
        if (srvRes.ok) {
          const srvJson = (await srvRes.json()) as { text?: string };
          const cleaned = cleanSpokenTranscript(srvJson.text ?? '');
          if (cleaned && !isWhisperHallucination(cleaned)) {
            setVoiceHint(`Transcribed: "${cleaned}"`);
            await submitVoiceText(cleaned);
            return;
          }
          setVoiceError('No clear speech detected in that pause. Tap Speak and speak clearly.');
          setVoiceHint(null);
          return;
        }
      }

      // 2. 100% Free On-Device Open-Source Whisper (Web Worker ONNX WASM)
      const pcm16k = await decodeBlobToMono16k(blob);
      const worker = getOrCreateWhisperWorker();
      const reqId = `req-${Date.now()}`;
      setVoiceHint(
        modelProgress !== null
          ? `Loading free on-device Whisper AI (${modelProgress}%)...`
          : 'Transcribing locally with open-source Whisper...',
      );

      const rawText = await new Promise<string>((resolve, reject) => {
        workerPendingRef.current.set(reqId, { resolve, reject });
        worker.postMessage({ type: 'transcribe', id: reqId, audio: pcm16k, locale }, [
          pcm16k.buffer,
        ]);
      });

      const cleaned = cleanSpokenTranscript(rawText);
      if (!cleaned || isWhisperHallucination(cleaned)) {
        setVoiceError('No clear speech detected in that pause. Tap Speak and speak clearly.');
        setVoiceHint(null);
        return;
      }

      setVoiceHint(`Whisper heard: "${cleaned}"`);
      await submitVoiceText(cleaned);
    } catch (err) {
      setVoiceError(
        err instanceof Error
          ? `Whisper transcription error: ${err.message}. You can also type below.`
          : 'Unable to transcribe audio. Please type below.',
      );
      setVoiceHint(null);
    } finally {
      setTranscribingAudio(false);
    }
  }

  async function startWhisperRecording() {
    bargeInStop();
    setVoiceError(null);
    setVoiceHint(null);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setVoiceError('Microphone recording is unavailable in this browser. Type your message below.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      mediaStreamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        setListening(false);
        setActiveModeLabel(null);
        cleanupAudioCapture();

        const fullBlob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (manualStopRef.current && fullBlob.size < 1200) {
          setVoiceHint(null);
          return;
        }
        if (fullBlob.size > 0) {
          void transcribeAudioWithWhisper(fullBlob);
        }
      };

      // Live Web Audio AnalyserNode for Wispr-style waveform bars + automatic silence VAD cutoff
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      vadCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      let heardSpeech = false;
      let silenceStartedAt: number | null = null;
      const maxClipDeadline = Date.now() + 28_000;

      const sampleAudioFrame = () => {
        if (recorder.state !== 'recording') return;
        analyser.getByteFrequencyData(dataArray);
        let energySum = 0;
        const bars = BAR_INDICES.map((i) => {
          const val = (dataArray[i % dataArray.length] ?? 0) / 255;
          energySum += val;
          return Math.max(0.14, Math.min(1, val * 1.45));
        });
        setAudioLevels(bars);

        const avgEnergy = energySum / BAR_INDICES.length;
        if (avgEnergy > 0.035) {
          heardSpeech = true;
          silenceStartedAt = null;
        } else if (heardSpeech) {
          if (silenceStartedAt === null) {
            silenceStartedAt = Date.now();
          } else if (Date.now() - silenceStartedAt > 1650) {
            manualStopRef.current = false;
            if (recorder.state === 'recording') recorder.stop();
            return;
          }
        }

        if (Date.now() > maxClipDeadline) {
          manualStopRef.current = false;
          if (recorder.state === 'recording') recorder.stop();
          return;
        }

        vadRafRef.current = requestAnimationFrame(sampleAudioFrame);
      };

      manualStopRef.current = false;
      recorder.start(250);
      setListening(true);
      setActiveModeLabel(
        serverWhisperAvailable ? 'Wispr Cloud Whisper' : 'Open-Source Whisper AI',
      );
      setVoiceHint('Speak naturally — stops automatically when you finish your sentence.');
      vadRafRef.current = requestAnimationFrame(sampleAudioFrame);
    } catch (err) {
      cleanupAudioCapture();
      setListening(false);
      setVoiceError(
        err instanceof Error && /denied|NotAllowed/i.test(err.message)
          ? 'Microphone access was blocked. Allow microphone access in browser settings or type below.'
          : 'Could not open microphone. Please check device audio settings or type below.',
      );
    }
  }

  function startBrowserSpeechRecognition() {
    bargeInStop();
    setVoiceError(null);
    setVoiceHint(null);

    const SpeechCtor = resolveSpeechRecognition();
    if (!SpeechCtor) {
      void startWhisperRecording();
      return;
    }

    try {
      const recog = new SpeechCtor();
      recognitionRef.current = recog;
      capturedFinalRef.current = '';
      latestInterimRef.current = '';
      manualStopRef.current = false;

      recog.lang = locale === 'kn' ? 'kn-IN' : locale === 'hi' ? 'hi-IN' : 'en-IN';
      recog.interimResults = true;
      // Continuous avoids abrupt mid-sentence cutoffs while still allowing pause-based auto-send
      recog.continuous = true;
      recog.maxAlternatives = 1;

      const scheduleAutoCommit = () => {
        if (speechSilenceTimerRef.current) clearTimeout(speechSilenceTimerRef.current);
        speechSilenceTimerRef.current = setTimeout(() => {
          if (!manualStopRef.current && (capturedFinalRef.current || latestInterimRef.current).trim()) {
            try {
              recog.stop();
            } catch {
              // Ignore stop error
            }
          }
        }, 1600);
      };

      recog.onresult = (ev) => {
        let finalText = '';
        let interimText = '';
        for (let i = 0; i < ev.results.length; i += 1) {
          const result = ev.results[i];
          if (!result) continue;
          const text = result[0]?.transcript ?? '';
          if (!text) continue;
          if (result.isFinal) finalText += `${text} `;
          else interimText += `${text} `;
        }
        const combined = `${finalText}${interimText}`.trim();
        latestInterimRef.current = combined;
        if (combined) {
          setTranscript(combined);
          scheduleAutoCommit();
        }
        if (finalText.trim()) capturedFinalRef.current = finalText.trim();
      };

      recog.onerror = (ev) => {
        if (speechSilenceTimerRef.current) clearTimeout(speechSilenceTimerRef.current);
        setListening(false);
        setActiveModeLabel(null);
        // Automatic Wispr upgrade: if browser cloud Speech fails on network/language, fall back cleanly to Open-Source Whisper
        if (
          enginePref === 'auto' &&
          (ev.error === 'network' || ev.error === 'language-not-supported')
        ) {
          setEnginePref('whisper_ai');
          void startWhisperRecording();
          return;
        }
        const msg = mapSpeechErrorMessage(ev.error);
        if (msg) setVoiceError(msg);
      };

      recog.onend = () => {
        if (speechSilenceTimerRef.current) clearTimeout(speechSilenceTimerRef.current);
        setListening(false);
        setActiveModeLabel(null);
        recognitionRef.current = null;
        const spokenRaw = (capturedFinalRef.current || latestInterimRef.current).trim();
        const cleaned = cleanSpokenTranscript(spokenRaw);
        if (cleaned && !isWhisperHallucination(cleaned) && !manualStopRef.current) {
          setVoiceHint(`Heard "${cleaned}" — replying...`);
          void submitVoiceText(cleaned);
        }
      };

      setListening(true);
      setActiveModeLabel('Live Dictation + Auto Cleanup');
      setVoiceHint('Listening live — speak freely and pause briefly when finished.');
      recog.start();
    } catch {
      void startWhisperRecording();
    }
  }

  function startSelectedCapture() {
    if (enginePref === 'whisper_ai') {
      void startWhisperRecording();
    } else if (enginePref === 'auto' && serverWhisperAvailable) {
      void startWhisperRecording();
    } else {
      startBrowserSpeechRecognition();
    }
  }

  startListeningRef.current = startSelectedCapture;

  function toggleMicListening() {
    if (listening) {
      manualStopRef.current = true;
      setHandsFreeMode(false);
      if (mediaRecorderRef.current?.state === 'recording') {
        manualStopRef.current = false; // Still process already spoken clip when user clicks Stop!
        mediaRecorderRef.current.stop();
        return;
      }
      try {
        recognitionRef.current?.stop();
      } catch {
        setListening(false);
      }
      return;
    }
    startSelectedCapture();
  }

  async function submitVoiceText(textToSubmit: string) {
    const clean = textToSubmit.trim();
    if (!clean || submitting) return;

    const userTurnId = `u-${Date.now()}`;
    const priorHistory = messages
      .filter((m) => m.id !== 'welcome')
      .slice(-8)
      .map((m) => ({ role: m.role, text: m.text }));

    setMessages((prev) => [...prev, { id: userTurnId, role: 'user', text: clean }]);
    setTranscript('');
    setSubmitting(true);
    setVoiceError(null);
    bargeInStop();

    try {
      const res = await fetch('/api/v1/voice/checkin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          patientId,
          transcript: clean,
          locale,
          channel: wsConnected ? 'open_llm_vtuber' : 'web_voice',
          isSynthetic,
          history: priorHistory,
        }),
      });
      const body = (await res.json()) as {
        error?: string;
        conversationOnly?: boolean;
        responderSource?: string;
        analysis?: { replyText: string; redFlag: boolean; symptoms: string[] };
      };

      if (res.ok && body.analysis) {
        const replyText = body.analysis.replyText;
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            text: replyText,
            redFlag: body.analysis?.redFlag,
            responderSource: body.responderSource,
          },
        ]);
        setVoiceHint(null);

        speakText(replyText, () => {
          if (handsFreeRef.current && !manualStopRef.current) {
            startListeningRef.current();
          }
        });

        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'sentinel_reply', text: replyText }));
        }
        if (!body.conversationOnly) {
          onRecorded();
        }
      } else {
        setVoiceError(body.error ?? 'Could not process voice message.');
      }
    } catch {
      setVoiceError('Network error sending message.');
    } finally {
      setSubmitting(false);
    }
  }

  const latestAssistantId =
    [...messages].reverse().find((m) => m.role === 'assistant')?.id ?? null;

  return (
    <section
      aria-label="Real-Time Voice Companion"
      className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <MessageSquareHeart className="h-5 w-5 text-[var(--brand-primary)]" aria-hidden="true" />
            <h2 className="text-xl font-semibold">Voice Check-In Companion</h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-mint-panel)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--brand-accent-text)]">
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              <span>{whisperProviderLabel}</span>
            </span>
          </div>
          <p className="mt-0.5 text-sm text-[var(--text-muted)]">
            Wispr-style filler removal, silence auto-send &amp; open-source Whisper AI in English,
            Kannada, or Hindi.{wsConnected ? ' · Open-LLM-VTuber WS live' : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="voice-engine-select" className="sr-only">
            Speech transcription engine
          </label>
          <select
            id="voice-engine-select"
            value={enginePref}
            onChange={(e) => setEnginePref(e.target.value as VoiceEnginePreference)}
            className="min-h-11 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-xs font-semibold text-[var(--text-primary)]"
          >
            <option value="auto">Auto (Wispr + Whisper)</option>
            <option value="whisper_ai">Open-Source Whisper AI (Offline)</option>
            <option value="live_speech">Instant Live Dictation</option>
          </select>

          <button
            type="button"
            onClick={() => {
              if (autoSpeak) bargeInStop();
              setAutoSpeak((v) => !v);
            }}
            aria-pressed={autoSpeak}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-xs font-semibold hover:bg-[var(--bg-elevated)] cursor-pointer"
          >
            {autoSpeak ? (
              <Volume2 className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
            ) : (
              <VolumeX className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
            )}
            <span>{autoSpeak ? 'Voice Replies On' : 'Muted'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const next = !handsFreeMode;
              setHandsFreeMode(next);
              if (next && !listening) startSelectedCapture();
            }}
            aria-pressed={handsFreeMode}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold cursor-pointer ${handsFreeMode
              ? 'border-[var(--brand-primary)] bg-[var(--bg-mint-panel)] text-[var(--brand-accent-text)]'
              : 'border-[var(--border-subtle)] bg-[var(--bg-base)] hover:bg-[var(--bg-elevated)]'
              }`}
          >
            <span>{handsFreeMode ? 'Hands-Free Chat On' : 'Hands-Free Chat'}</span>
          </button>

          <button
            type="button"
            onClick={toggleMicListening}
            disabled={transcribingAudio}
            className={`inline-flex min-h-12 items-center gap-2 rounded-xl border px-4 text-base font-semibold cursor-pointer disabled:opacity-60 ${listening
              ? 'border-[var(--status-urgent)] bg-[var(--status-urgent-bg)] text-[var(--status-urgent)]'
              : 'border-[var(--border-subtle)] bg-[var(--bg-base)] hover:bg-[var(--bg-elevated)]'
              }`}
          >
            {transcribingAudio ? (
              <Loader2 className="h-5 w-5 animate-spin text-[var(--brand-primary)]" aria-hidden="true" />
            ) : listening ? (
              <MicOff className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Mic className="h-5 w-5 text-[var(--brand-primary)]" aria-hidden="true" />
            )}
            <span>{transcribingAudio ? 'Transcribing...' : listening ? 'Finish & Send' : 'Speak'}</span>
          </button>

          {speaking && (
            <button
              type="button"
              onClick={bargeInStop}
              className="inline-flex min-h-12 items-center gap-1.5 rounded-xl bg-[var(--status-watch)] px-4 text-base font-semibold text-white cursor-pointer"
            >
              <Square className="h-4 w-4" aria-hidden="true" />
              <span>Stop Speaking</span>
            </button>
          )}
        </div>
      </div>

      {/* Wispr-Flow style animated voice waveform & mode indicator when capturing */}
      {(listening || modelProgress !== null) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--brand-primary)] bg-[var(--bg-mint-panel)] px-4 py-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--brand-accent-text)]">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--status-urgent)] animate-pulse" />
            <span>
              {activeModeLabel ?? 'Voice Engine'}
              {modelProgress !== null ? ` · Downloading Whisper AI ${modelProgress}%` : ''}
            </span>
          </div>
          <div className="flex h-6 items-end gap-1" aria-hidden="true">
            {audioLevels.map((lvl, idx) => (
              <span
                key={idx}
                style={{ height: `${Math.round(lvl * 24)}px` }}
                className="w-1 rounded-full bg-[var(--brand-primary)] transition-all duration-75"
              />
            ))}
          </div>
        </div>
      )}

      {voiceHint && (
        <p
          role="status"
          className="mt-3 rounded-xl bg-[var(--bg-elevated)] px-3.5 py-2 text-sm font-medium text-[var(--brand-accent-text)]"
        >
          {voiceHint}
        </p>
      )}

      {voiceError && (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-[var(--status-watch)] bg-[var(--status-watch-bg)] px-3.5 py-2 text-sm font-medium text-[var(--status-watch)]"
        >
          {voiceError}
        </p>
      )}

      {/* Live Multi-Turn Conversation Thread */}
      <div
        tabIndex={0}
        role="region"
        aria-label="Voice companion conversation"
        aria-live="polite"
        className="mt-4 max-h-72 space-y-2.5 overflow-y-auto rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3.5 sm:p-4"
      >
        {messages.map((msg) => {
          const isLatestReply = msg.id === latestAssistantId && msg.id !== 'welcome';
          if (msg.role === 'user') {
            return (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--brand-primary)] px-4 py-2.5 text-sm font-medium text-[var(--brand-primary-fg)] sm:text-base">
                  {msg.text}
                </div>
              </div>
            );
          }

          return (
            <div key={msg.id} className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--bg-mint-panel)] text-[var(--brand-primary)]">
                <Bot className="h-4 w-4" aria-hidden="true" />
              </span>
              <div
                data-testid={isLatestReply ? 'voice-companion-reply' : undefined}
                role={msg.redFlag ? 'alert' : undefined}
                className={`max-w-[88%] rounded-2xl rounded-tl-sm border px-4 py-2.5 text-sm font-medium sm:text-base ${msg.redFlag
                  ? 'border-[var(--status-urgent)] bg-[var(--status-urgent-bg)] text-[var(--status-urgent)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)]'
                  }`}
              >
                {msg.text}
              </div>
            </div>
          );
        })}
        <div ref={threadEndRef} />
      </div>

      {/* Live Speech/Text Input Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submitVoiceText(transcript);
        }}
        className="mt-3 flex flex-col gap-2 sm:flex-row"
      >
        <label htmlFor="voice-transcript-input" className="sr-only">
          Voice transcript input
        </label>
        <input
          id="voice-transcript-input"
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder="Say hello, ask how your vitals look, or tell me any problem..."
          className="min-h-12 min-w-0 flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 text-base"
        />
        <button
          type="submit"
          disabled={submitting || transcribingAudio || !transcript.trim()}
          className="inline-flex min-h-12 w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-[var(--brand-primary)] px-5 text-base font-semibold text-[var(--brand-primary-fg)] disabled:opacity-50 cursor-pointer"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          <span>{submitting ? 'Replying...' : 'Send'}</span>
        </button>
      </form>
    </section>
  );
}
