'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  ClipboardCheck,
  FileAudio,
  FileText,
  History,
  Loader2,
  Mic,
  MicOff,
  Pill,
  Plus,
  Printer,
  Send,
  Sparkles,
  Square,
  Stethoscope,
  Trash2,
  UserRound,
  Volume2,
} from 'lucide-react';
import type {
  OpdPatientSummaryData,
  OpdPrescriptionItemData,
  OpdSoapNoteData,
} from '@/db/schema';
import {
  classifyConsultationSpeaker,
  formatTurnsToTranscript,
  parseTranscriptIntoTurns,
  type ConsultationSpeaker,
  type ConsultationTurn,
} from '@/lib/clinician/diarization';
import {
  extractLiveClinicalPreview,
  type OpdLanguageMix,
  type OpdSampleScenario,
} from '@/lib/clinician/opd-scribe';
import {
  cleanSpokenTranscript,
  isWhisperHallucination,
} from '@/lib/voice/transcript-cleaner';

export interface ScribeCohortOption {
  patientId: string;
  patientName: string;
  ageBand: string;
  level: string;
  deteriorationIndex: number;
}

export interface OpdConsultationRecord {
  id: string;
  patientId: string | null;
  patientLabel: string;
  languageMix: string;
  transcript: string;
  soapNote: OpdSoapNoteData;
  prescriptionDraft: OpdPrescriptionItemData[];
  patientSummary: OpdPatientSummaryData;
  generatorSource: string;
  status: string;
  syncedMedicationsCount: number;
  approvedAt: string | null;
  createdAt: string;
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
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

const BAR_INDICES = Array.from({ length: 16 }, (_, i) => i);

function resolveSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

function mapSpeechErrorMessage(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone permission was blocked. Allow mic access in browser settings or switch to Open-Source Whisper AI.';
    case 'no-speech':
      return 'No speech detected in that pause — still ready for next turn.';
    case 'audio-capture':
      return 'No working microphone found on this device.';
    case 'aborted':
      return '';
    default:
      return `Live dictation notice (${code}). Switching or ready to retry.`;
  }
}

async function decodeBlobToMono16k(blob: Blob): Promise<Float32Array> {
  const buf = await blob.arrayBuffer();
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx({ sampleRate: 16000 });
  try {
    const decoded = await ctx.decodeAudioData(buf);
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
    await ctx.close().catch(() => {});
  }
}

export function OpdScribeWorkspace({
  cohort,
  selectedPatientId,
  onSelectPatient,
}: {
  cohort: ScribeCohortOption[];
  selectedPatientId: string | null;
  onSelectPatient?: (patientId: string) => void;
}) {
  const qc = useQueryClient();

  const [patientMode, setPatientMode] = useState<'linked' | 'walkin'>(
    cohort.length > 0 ? 'linked' : 'walkin',
  );
  const [walkinLabel, setWalkinLabel] = useState('Walk-in OPD Patient');
  const [languageMix, setLanguageMix] = useState<OpdLanguageMix>('en_kn_hi');
  const [micLangTag, setMicLangTag] = useState<'en-IN' | 'kn-IN' | 'hi-IN'>('en-IN');

  // Wispr Engine State (ported cleanly from Patient VoiceCheckinCompanion)
  const [enginePref, setEnginePref] = useState<VoiceEnginePreference>('auto');
  const [serverWhisperAvailable, setServerWhisperAvailable] = useState(false);
  const [whisperProviderLabel, setWhisperProviderLabel] = useState(
    'Wispr Live Speech + Whisper Base (On-Device)',
  );
  const [modelProgress, setModelProgress] = useState<number | null>(null);
  const [transcribingAudio, setTranscribingAudio] = useState(false);
  const [listening, setListening] = useState(false);
  const [activeModeLabel, setActiveModeLabel] = useState<string | null>(null);
  const [audioLevels, setAudioLevels] = useState<number[]>(() => BAR_INDICES.map(() => 0.14));
  const [continuousOpd, setContinuousOpd] = useState(true);
  const [voiceHint, setVoiceHint] = useState<string | null>(null);

  // Live Conversation Turns + Transcript
  const [turns, setTurns] = useState<ConsultationTurn[]>([]);
  const [transcript, setTranscript] = useState('');
  const [interimText, setInterimText] = useState('');
  const [speakerLock, setSpeakerLock] = useState<'auto' | ConsultationSpeaker>('auto');
  const [quickUtterance, setQuickUtterance] = useState('');
  const [showRawTranscript, setShowRawTranscript] = useState(false);
  const [autoGenerateLive, setAutoGenerateLive] = useState(true);

  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Active Draft / Approved Consultation State
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeStatus, setActiveStatus] = useState<'draft' | 'approved'>('draft');
  const [activeGenerator, setActiveGenerator] = useState<string>(
    'Wispr + Multilingual OPD Scribe Engine',
  );
  const [soapNote, setSoapNote] = useState<OpdSoapNoteData | null>(null);
  const [rxDraft, setRxDraft] = useState<OpdPrescriptionItemData[]>([]);
  const [patientSummary, setPatientSummary] = useState<OpdPatientSummaryData | null>(null);
  const [summaryLangTab, setSummaryLangTab] = useState<'en' | 'kn' | 'hi'>('en');
  const [syncMedications, setSyncMedications] = useState(true);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const capturedFinalRef = useRef('');
  const latestInterimRef = useRef('');
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
  const continuousOpdRef = useRef(true);
  const speakerLockRef = useRef<'auto' | ConsultationSpeaker>('auto');
  const micLangTagRef = useRef<'en-IN' | 'kn-IN' | 'hi-IN'>('en-IN');
  const turnsRef = useRef<ConsultationTurn[]>([]);
  const autoGenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startCaptureRef = useRef<() => void>(() => {});
  const feedEndRef = useRef<HTMLDivElement | null>(null);

  continuousOpdRef.current = continuousOpd;
  speakerLockRef.current = speakerLock;
  micLangTagRef.current = micLangTag;
  turnsRef.current = turns;

  const effectivePatientId =
    patientMode === 'linked' ? (selectedPatientId ?? cohort[0]?.patientId ?? null) : null;

  const liveCues = useMemo(() => extractLiveClinicalPreview(turns), [turns]);

  const interimPrediction = useMemo(() => {
    if (!interimText.trim()) return null;
    const prev = turns[turns.length - 1];
    return classifyConsultationSpeaker(interimText, {
      previousSpeaker: prev?.speaker,
      previousText: prev?.text,
      manualSpeaker: speakerLock,
    });
  }, [interimText, turns, speakerLock]);

  useEffect(() => {
    let active = true;
    fetch('/api/v1/voice/transcribe')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { serverWhisperAvailable?: boolean; providerLabel?: string } | null) => {
        if (!active || !data) return;
        setServerWhisperAvailable(Boolean(data.serverWhisperAvailable));
        if (data.providerLabel) setWhisperProviderLabel(data.providerLabel);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (cohort.length === 0 && patientMode === 'linked') {
      setPatientMode('walkin');
    }
  }, [cohort.length, patientMode]);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [turns.length, interimText]);

  const cleanupAudioCapture = useCallback(() => {
    if (speechSilenceTimerRef.current) {
      clearTimeout(speechSilenceTimerRef.current);
      speechSilenceTimerRef.current = null;
    }
    if (speechRestartTimerRef.current) {
      clearTimeout(speechRestartTimerRef.current);
      speechRestartTimerRef.current = null;
    }
    if (vadRafRef.current !== null) {
      cancelAnimationFrame(vadRafRef.current);
      vadRafRef.current = null;
    }
    if (vadCtxRef.current) {
      void vadCtxRef.current.close().catch(() => {});
      vadCtxRef.current = null;
    }
    if (mediaStreamRef.current) {
      for (const t of mediaStreamRef.current.getTracks()) t.stop();
      mediaStreamRef.current = null;
    }
    setAudioLevels(BAR_INDICES.map(() => 0.14));
  }, []);

  useEffect(() => {
    return () => {
      manualStopRef.current = true;
      continuousOpdRef.current = false;
      try {
        recognitionRef.current?.abort();
      } catch {}
      if (mediaRecorderRef.current?.state === 'recording') {
        try {
          mediaRecorderRef.current.stop();
        } catch {}
      }
      cleanupAudioCapture();
      if (autoGenTimerRef.current) clearTimeout(autoGenTimerRef.current);
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [cleanupAudioCapture]);

  function getOrCreateWhisperWorker(): Worker {
    if (workerRef.current) return workerRef.current;
    const worker = new Worker(new URL('../voice/whisper.worker.ts', import.meta.url), {
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

  const scribeQuery = useQuery<{
    consultations: OpdConsultationRecord[];
    capabilities: { extractorEngine: string; llmConfigured: boolean };
    sampleScenarios: OpdSampleScenario[];
  }>({
    queryKey: ['clinician-opd-scribe'],
    queryFn: async () => {
      const res = await fetch('/api/v1/clinician/scribe');
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      return body;
    },
  });

  const generateMutation = useMutation({
    mutationFn: async (transcriptOverride?: string) => {
      const targetText = (transcriptOverride ?? transcript).trim();
      const res = await fetch('/api/v1/clinician/scribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'generate',
          patientId: effectivePatientId,
          patientLabel: patientMode === 'walkin' ? walkinLabel : undefined,
          languageMix,
          transcript: targetText,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? 'Failed to structure consultation');
      return body as { consultation: OpdConsultationRecord };
    },
    onSuccess: ({ consultation }) => {
      setErrorBanner(null);
      setActiveId(consultation.id);
      setActiveStatus('draft');
      setActiveGenerator('Wispr + Multilingual OPD Scribe + RxNorm');
      setSoapNote(consultation.soapNote);
      setRxDraft(consultation.prescriptionDraft);
      setPatientSummary(consultation.patientSummary);
      setStatusBanner(
        'Structured SOAP note, draft Rx, and multilingual patient summary ready for doctor approval.',
      );
      qc.invalidateQueries({ queryKey: ['clinician-opd-scribe'] });
    },
    onError: (err) => {
      setErrorBanner(err instanceof Error ? err.message : 'Unable to generate consultation draft.');
    },
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      if (!activeId || !soapNote || !patientSummary) {
        throw new Error('Generate or load a consultation draft first.');
      }
      const res = await fetch('/api/v1/clinician/scribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'approve',
          consultationId: activeId,
          soapNote,
          prescriptionDraft: rxDraft,
          patientSummary,
          syncMedications: Boolean(effectivePatientId && syncMedications),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? 'Approval failed');
      return body as { consultation: OpdConsultationRecord; syncedMedicationsCount: number };
    },
    onSuccess: ({ consultation, syncedMedicationsCount }) => {
      setErrorBanner(null);
      setActiveStatus('approved');
      setRxDraft(consultation.prescriptionDraft);
      setStatusBanner(
        syncedMedicationsCount > 0
          ? `Consultation approved & signed. ${syncedMedicationsCount} Rx medication(s) synced to patient's active regimen.`
          : 'Consultation approved, signed, and sealed into the tamper-evident audit ledger.',
      );
      qc.invalidateQueries({ queryKey: ['clinician-opd-scribe'] });
      if (effectivePatientId) {
        qc.invalidateQueries({ queryKey: ['dashboard-patient', effectivePatientId] });
      }
    },
    onError: (err) => {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to approve consultation.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (consultationId: string) => {
      const res = await fetch('/api/v1/clinician/scribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'delete', consultationId }),
      });
      if (!res.ok) throw new Error('Delete failed');
      return consultationId;
    },
    onSuccess: (deletedId) => {
      if (activeId === deletedId) {
        setActiveId(null);
        setSoapNote(null);
        setRxDraft([]);
        setPatientSummary(null);
      }
      qc.invalidateQueries({ queryKey: ['clinician-opd-scribe'] });
    },
  });

  const appendSpokenPhrase = useCallback(
    (rawPhrase: string, overrideLock?: 'auto' | ConsultationSpeaker): boolean => {
      const cleaned = cleanSpokenTranscript(rawPhrase.trim());
      if (!cleaned || isWhisperHallucination(cleaned)) return false;

      const splitTurns = parseTranscriptIntoTurns(cleaned);
      const prevTurns = [...turnsRef.current];
      let addedCount = 0;

      if (splitTurns.length > 1) {
        for (const st of splitTurns) {
          if (isWhisperHallucination(st.text)) continue;
          const last = prevTurns[prevTurns.length - 1];
          const cls = classifyConsultationSpeaker(st.text, {
            previousSpeaker: last?.speaker,
            previousText: last?.text,
            manualSpeaker: overrideLock ?? speakerLockRef.current,
          });
          prevTurns.push({
            id: `turn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            speaker: cls.speaker,
            confidence: cls.confidence,
            text: st.text,
            languageHint: cls.languageHint,
            reasons: cls.reasons,
            timestampIso: new Date().toISOString(),
          });
          addedCount += 1;
        }
      } else {
        const cleanBody = cleaned.replace(/^(?:doctor|dr\.?|patient|pt\.?)\s*:\s*/i, '').trim();
        if (!cleanBody || isWhisperHallucination(cleanBody)) return false;
        const last = prevTurns[prevTurns.length - 1];
        const cls = classifyConsultationSpeaker(cleaned, {
          previousSpeaker: last?.speaker,
          previousText: last?.text,
          manualSpeaker: overrideLock ?? speakerLockRef.current,
        });
        prevTurns.push({
          id: `turn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          speaker: cls.speaker,
          confidence: cls.confidence,
          text: cleanBody,
          languageHint: cls.languageHint,
          reasons: cls.reasons,
          timestampIso: new Date().toISOString(),
        });
        addedCount += 1;
      }

      if (addedCount === 0) return false;

      turnsRef.current = prevTurns;
      setTurns(prevTurns);
      const nextTranscript = formatTurnsToTranscript(prevTurns);
      setTranscript(nextTranscript);

      if (autoGenerateLive && prevTurns.length >= 2 && nextTranscript.length >= 16) {
        if (autoGenTimerRef.current) clearTimeout(autoGenTimerRef.current);
        autoGenTimerRef.current = setTimeout(() => {
          if (!generateMutation.isPending) {
            generateMutation.mutate(nextTranscript);
          }
        }, 1200);
      }
      return true;
    },
    [autoGenerateLive, generateMutation],
  );

  function resolveWhisperLocale(): 'en' | 'kn' | 'hi' | 'mixed' {
    if (micLangTagRef.current === 'kn-IN') return 'kn';
    if (micLangTagRef.current === 'hi-IN') return 'hi';
    if (languageMix === 'en') return 'en';
    return 'mixed';
  }

  async function transcribeAudioWithWispr(blob: Blob, resumeAfter = true) {
    if (speechRestartTimerRef.current) {
      clearTimeout(speechRestartTimerRef.current);
      speechRestartTimerRef.current = null;
    }
    setTranscribingAudio(true);
    setVoiceHint('Cleaning speech with Wispr + open-source Whisper Base...');
    const whisperLocale = resolveWhisperLocale();

    try {
      // 1. Server Whisper endpoint (Groq / local Whisper server) when configured
      if (serverWhisperAvailable) {
        const fd = new FormData();
        fd.append('audio', blob, 'opd-turn.webm');
        fd.append('locale', whisperLocale);
        fd.append('mode', 'opd_ambient');
        const srvRes = await fetch('/api/v1/voice/transcribe', { method: 'POST', body: fd });
        if (srvRes.ok) {
          const srvJson = (await srvRes.json()) as { text?: string };
          const cleaned = cleanSpokenTranscript(srvJson.text ?? '');
          if (!cleaned || isWhisperHallucination(cleaned)) {
            setVoiceHint(
              'Filtered quiet ambient pause — speak closer to the mic or tap Dictate EN / KN / HI.',
            );
            return;
          }
          if (appendSpokenPhrase(cleaned)) {
            setVoiceHint(`Wispr heard: "${cleaned}"`);
          }
          return;
        }
      }

      // 2. 100% Free On-Device Open-Source Whisper Base (ONNX WASM worker + RMS silence gate)
      const pcm16k = await decodeBlobToMono16k(blob);
      const worker = getOrCreateWhisperWorker();
      const reqId = `opd-${Date.now()}`;
      setVoiceHint(
        modelProgress !== null
          ? `Loading Wispr Whisper Base (${modelProgress}%)...`
          : `Transcribing locally with Whisper Base (${whisperLocale === 'mixed' ? 'Multi EN/KN/HI' : whisperLocale.toUpperCase()})...`,
      );

      const rawText = await new Promise<string>((resolve, reject) => {
        workerPendingRef.current.set(reqId, { resolve, reject });
        worker.postMessage(
          { type: 'transcribe', id: reqId, audio: pcm16k, locale: whisperLocale },
          [pcm16k.buffer],
        );
      });

      const cleaned = cleanSpokenTranscript(rawText);
      if (!cleaned || isWhisperHallucination(cleaned)) {
        setVoiceHint(
          'Filtered quiet/ambient noise pause (no clear speech). Speak clearly or choose Dictate KN / HI / EN.',
        );
        return;
      }
      if (appendSpokenPhrase(cleaned)) {
        setVoiceHint(`Wispr heard: "${cleaned}"`);
      }
    } catch (err) {
      setErrorBanner(
        err instanceof Error
          ? `Wispr transcription error: ${err.message}`
          : 'Unable to transcribe audio clip.',
      );
      setVoiceHint(null);
    } finally {
      setTranscribingAudio(false);
      if (resumeAfter && continuousOpdRef.current && !manualStopRef.current) {
        speechRestartTimerRef.current = setTimeout(() => {
          if (continuousOpdRef.current && !manualStopRef.current) {
            startCaptureRef.current();
          }
        }, 250);
      }
    }
  }

  async function startWhisperRecording() {
    setErrorBanner(null);
    setVoiceHint(null);
    if (speechRestartTimerRef.current) {
      clearTimeout(speechRestartTimerRef.current);
      speechRestartTimerRef.current = null;
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setErrorBanner('Microphone recording unavailable in this browser.');
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

      let heardSpeech = false;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        setListening(false);
        setActiveModeLabel(null);
        mediaRecorderRef.current = null;
        cleanupAudioCapture();

        const fullBlob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (!heardSpeech && !manualStopRef.current) {
          setVoiceHint('Listening cleanly — waiting for voice activity...');
          if (continuousOpdRef.current) {
            speechRestartTimerRef.current = setTimeout(() => {
              if (continuousOpdRef.current && !manualStopRef.current) {
                startCaptureRef.current();
              }
            }, 250);
          }
          return;
        }
        if (manualStopRef.current && fullBlob.size < 1200) {
          setVoiceHint('Wispr listening stopped.');
          return;
        }
        if (fullBlob.size > 0) {
          void transcribeAudioWithWispr(fullBlob, !manualStopRef.current);
        }
      };

      // Wispr Web Audio AnalyserNode: 16 waveform bars + automatic VAD silence cutoff (1.65s)
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
        if (avgEnergy > 0.03) {
          heardSpeech = true;
          silenceStartedAt = null;
        } else if (heardSpeech) {
          if (silenceStartedAt === null) {
            silenceStartedAt = Date.now();
          } else if (Date.now() - silenceStartedAt > 1650) {
            if (recorder.state === 'recording') recorder.stop();
            return;
          }
        }

        if (Date.now() > maxClipDeadline) {
          if (recorder.state === 'recording') recorder.stop();
          return;
        }

        vadRafRef.current = requestAnimationFrame(sampleAudioFrame);
      };

      manualStopRef.current = false;
      recorder.start(250);
      setListening(true);
      setActiveModeLabel(
        serverWhisperAvailable ? 'Wispr Cloud Whisper' : 'Whisper Base AI (On-Device)',
      );
      setVoiceHint(
        'Wispr Whisper listening — speak a Doctor or Patient turn; auto-transcribes & filters room silence on pause.',
      );
      vadRafRef.current = requestAnimationFrame(sampleAudioFrame);
    } catch (err) {
      cleanupAudioCapture();
      setListening(false);
      setErrorBanner(
        err instanceof Error && /denied|NotAllowed/i.test(err.message)
          ? 'Microphone access was blocked. Allow microphone permission in browser settings.'
          : 'Could not open microphone. Please check device audio settings.',
      );
    }
  }

  function startBrowserSpeechRecognition() {
    setErrorBanner(null);
    setVoiceHint(null);
    if (speechRestartTimerRef.current) {
      clearTimeout(speechRestartTimerRef.current);
      speechRestartTimerRef.current = null;
    }

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
      let skipOnEndRestart = false;

      const activeLang = micLangTagRef.current;
      recog.lang = activeLang;
      recog.interimResults = true;
      recog.continuous = true;
      recog.maxAlternatives = 1;

      const scheduleAutoCommit = () => {
        if (speechSilenceTimerRef.current) clearTimeout(speechSilenceTimerRef.current);
        speechSilenceTimerRef.current = setTimeout(() => {
          if (
            !manualStopRef.current &&
            (capturedFinalRef.current || latestInterimRef.current).trim()
          ) {
            try {
              recog.stop();
            } catch {}
          }
        }, 1600);
      };

      recog.onresult = (ev) => {
        let finalText = '';
        let interim = '';
        for (let i = 0; i < ev.results.length; i += 1) {
          const result = ev.results[i];
          if (!result) continue;
          const phrase = result[0]?.transcript ?? '';
          if (!phrase) continue;
          if (result.isFinal) finalText += `${phrase} `;
          else interim += `${phrase} `;
        }
        const combined = `${finalText}${interim}`.trim();
        latestInterimRef.current = combined;
        setInterimText(combined);
        if (combined) scheduleAutoCommit();
        if (finalText.trim()) capturedFinalRef.current = finalText.trim();
      };

      recog.onerror = (ev) => {
        if (speechSilenceTimerRef.current) clearTimeout(speechSilenceTimerRef.current);
        setListening(false);
        setActiveModeLabel(null);
        // Automatic Wispr upgrade matching Patient section if browser speech fails
        if (
          enginePref === 'auto' &&
          (ev.error === 'network' || ev.error === 'language-not-supported')
        ) {
          skipOnEndRestart = true;
          recognitionRef.current = null;
          setEnginePref('whisper_ai');
          setVoiceHint(
            'Browser dictation unavailable for this network/locale — switching to on-device Whisper Base AI.',
          );
          void startWhisperRecording();
          return;
        }
        if (ev.error === 'no-speech' && continuousOpdRef.current && !manualStopRef.current) {
          // onend fires right after onerror and will cleanly resume without duplicate timers
          return;
        }
        if (
          ev.error === 'not-allowed' ||
          ev.error === 'service-not-allowed' ||
          ev.error === 'audio-capture'
        ) {
          skipOnEndRestart = true;
          manualStopRef.current = true;
        }
        const msg = mapSpeechErrorMessage(ev.error);
        if (msg) setErrorBanner(msg);
      };

      recog.onend = () => {
        if (speechSilenceTimerRef.current) clearTimeout(speechSilenceTimerRef.current);
        setListening(false);
        setActiveModeLabel(null);
        recognitionRef.current = null;
        const spokenRaw = (capturedFinalRef.current || latestInterimRef.current).trim();
        setInterimText('');
        const cleaned = cleanSpokenTranscript(spokenRaw);
        if (cleaned && !isWhisperHallucination(cleaned)) {
          if (appendSpokenPhrase(cleaned)) {
            setVoiceHint(`Heard (${activeLang}): "${cleaned}"`);
          }
        }
        if (!skipOnEndRestart && continuousOpdRef.current && !manualStopRef.current) {
          speechRestartTimerRef.current = setTimeout(() => {
            if (continuousOpdRef.current && !manualStopRef.current) {
              startCaptureRef.current();
            }
          }, 200);
        }
      };

      setListening(true);
      setActiveModeLabel(`Wispr Live Dictation (${activeLang})`);
      setVoiceHint(
        `Listening live (${activeLang}) — tap Dictate EN / KN / HI anytime to switch speech language.`,
      );
      recog.start();
    } catch {
      void startWhisperRecording();
    }
  }

  function startSelectedCapture() {
    manualStopRef.current = false;
    if (enginePref === 'whisper_ai') {
      void startWhisperRecording();
    } else if (enginePref === 'auto' && serverWhisperAvailable) {
      void startWhisperRecording();
    } else {
      startBrowserSpeechRecognition();
    }
  }

  startCaptureRef.current = startSelectedCapture;

  function toggleMicListening() {
    if (listening) {
      manualStopRef.current = true;
      if (speechRestartTimerRef.current) {
        clearTimeout(speechRestartTimerRef.current);
        speechRestartTimerRef.current = null;
      }
      if (mediaRecorderRef.current?.state === 'recording') {
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

  function handleMicLangChange(tag: 'en-IN' | 'kn-IN' | 'hi-IN') {
    setMicLangTag(tag);
    micLangTagRef.current = tag;
    if (listening && recognitionRef.current && mediaRecorderRef.current?.state !== 'recording') {
      setVoiceHint(`Switching live dictation language to ${tag}...`);
      try {
        recognitionRef.current.stop();
      } catch {}
    } else if (listening && mediaRecorderRef.current?.state === 'recording') {
      setVoiceHint(
        `Updated Whisper hint to ${tag === 'kn-IN' ? 'Kannada' : tag === 'hi-IN' ? 'Hindi' : 'English'} for next clip.`,
      );
    }
  }

  function swapTurnSpeaker(turnId: string) {
    const next = turns.map((t) =>
      t.id === turnId
        ? {
            ...t,
            speaker: (t.speaker === 'doctor' ? 'patient' : 'doctor') as ConsultationSpeaker,
            confidence: 1,
            reasons: ['clinician override'],
          }
        : t,
    );
    setTurns(next);
    setTranscript(formatTurnsToTranscript(next));
  }

  function deleteTurn(turnId: string) {
    const next = turns.filter((t) => t.id !== turnId);
    setTurns(next);
    setTranscript(formatTurnsToTranscript(next));
  }

  function handleQuickTurnSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!quickUtterance.trim()) return;
    appendSpokenPhrase(quickUtterance.trim());
    setQuickUtterance('');
  }

  function loadConsultation(rec: OpdConsultationRecord) {
    setActiveId(rec.id);
    setActiveStatus(rec.status === 'approved' ? 'approved' : 'draft');
    setActiveGenerator('Wispr + Multilingual OPD Scribe + RxNorm');
    setTurns(parseTranscriptIntoTurns(rec.transcript));
    setTranscript(rec.transcript);
    setSoapNote(rec.soapNote);
    setRxDraft(rec.prescriptionDraft);
    setPatientSummary(rec.patientSummary);
    setStatusBanner(`Loaded consultation for ${rec.patientLabel} (${rec.status}).`);
  }

  function speakSummary(lang: 'en' | 'kn' | 'hi', text: string) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = lang === 'kn' ? 'kn-IN' : lang === 'hi' ? 'hi-IN' : 'en-IN';
    window.speechSynthesis.speak(utt);
  }

  return (
    <div className="space-y-6">
      {errorBanner && (
        <div
          role="alert"
          className="rounded-xl border border-[var(--status-urgent)] bg-[var(--status-urgent-bg)] px-4 py-3 text-sm font-semibold text-[var(--status-urgent)]"
        >
          {errorBanner}
        </div>
      )}
      {statusBanner && (
        <div
          role="status"
          className="rounded-xl border border-[var(--status-stable)] bg-[var(--status-stable-bg)] px-4 py-3 text-sm font-semibold text-[var(--status-stable)]"
        >
          {statusBanner}
        </div>
      )}

      {/* Top Wispr Capture & Live Diarized Conversation Deck */}
      <section className="mint-bento p-4 sm:p-5 print:hidden">
        <div className="clinical-card p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--brand-primary)] bg-[var(--bg-mint-panel)] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[var(--brand-accent-text)]">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{whisperProviderLabel} · Zero-LLM Deterministic Scribe</span>
              </span>
              <h2 className="mt-2 font-[family-name:var(--font-display)] text-xl font-bold">
                Wispr OPD Ambient Scribe (Doctor ↔ Patient Live)
              </h2>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Uses SENTINEL&apos;s Wispr voice engine (auto silence cutoff, filler cleanup &amp; Whisper AI), classifies who is speaking (<strong>Doctor</strong> vs <strong>Patient</strong>) in code-mixed EN / ಕನ್ನಡ / हिन्दी, and builds the SOAP note, Rx draft, and patient summary locally without external LLMs.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="scribe-wispr-engine" className="sr-only">
                Speech transcription engine
              </label>
              <select
                id="scribe-wispr-engine"
                value={enginePref}
                onChange={(e) => setEnginePref(e.target.value as VoiceEnginePreference)}
                className="min-h-11 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-xs font-semibold text-[var(--text-primary)]"
              >
                <option value="auto">Auto (Wispr + Whisper)</option>
                <option value="whisper_ai">Open-Source Whisper AI (Offline)</option>
                <option value="live_speech">Live Speech Dictation</option>
              </select>
            </div>
          </div>

          {/* Row 1: Patient Binding + Language/Mic Controls + Wispr Equalizer Deck */}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3.5">
              <label className="block text-xs font-semibold text-[var(--text-muted)]" htmlFor="opd-patient-mode">
                Consultation Patient
              </label>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setPatientMode('linked')}
                  disabled={cohort.length === 0}
                  className={`min-h-10 flex-1 rounded-lg px-2.5 text-xs font-semibold cursor-pointer disabled:opacity-40 ${
                    patientMode === 'linked'
                      ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-fg)]'
                      : 'border border-[var(--border-subtle)] bg-[var(--bg-surface)]'
                  }`}
                >
                  Consented Cohort
                </button>
                <button
                  type="button"
                  onClick={() => setPatientMode('walkin')}
                  className={`min-h-10 flex-1 rounded-lg px-2.5 text-xs font-semibold cursor-pointer ${
                    patientMode === 'walkin'
                      ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-fg)]'
                      : 'border border-[var(--border-subtle)] bg-[var(--bg-surface)]'
                  }`}
                >
                  Walk-in OPD
                </button>
              </div>
              {patientMode === 'linked' && cohort.length > 0 ? (
                <select
                  id="opd-patient-mode"
                  value={effectivePatientId ?? ''}
                  onChange={(e) => onSelectPatient?.(e.target.value)}
                  className="mt-2 min-h-10 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 text-xs font-semibold"
                >
                  {cohort.map((c) => (
                    <option key={c.patientId} value={c.patientId}>
                      {c.patientName} ({c.ageBand}) · Index {c.deteriorationIndex}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="opd-patient-mode"
                  type="text"
                  value={walkinLabel}
                  onChange={(e) => setWalkinLabel(e.target.value)}
                  placeholder="Patient name / age / sex (e.g. Suresh 62M)"
                  className="mt-2 min-h-10 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 text-xs"
                />
              )}
            </div>

            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3.5">
              <label htmlFor="opd-lang-mix" className="block text-xs font-semibold text-[var(--text-muted)]">
                Consultation Language Mix
              </label>
              <select
                id="opd-lang-mix"
                value={languageMix}
                onChange={(e) => setLanguageMix(e.target.value as OpdLanguageMix)}
                className="mt-2 min-h-10 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 text-xs font-semibold"
              >
                <option value="en_kn_hi">Code-Mixed: English + Kannada + Hindi</option>
                <option value="en_kn">Bilingual: English + Kannada</option>
                <option value="en_hi">Bilingual: English + Hindi</option>
                <option value="en">English (India)</option>
              </select>
              <div className="mt-2 flex items-center gap-1.5">
                {(['en-IN', 'kn-IN', 'hi-IN'] as const).map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => handleMicLangChange(tag)}
                    className={`min-h-8 flex-1 rounded-md px-2 text-[11px] font-semibold cursor-pointer ${
                      micLangTag === tag
                        ? 'bg-[var(--brand-rail-active)] text-[var(--brand-rail-active-fg)]'
                        : 'border border-[var(--border-subtle)] bg-[var(--bg-surface)]'
                    }`}
                  >
                    {tag === 'en-IN' ? 'Dictate EN' : tag === 'kn-IN' ? 'Dictate KN' : 'Dictate HI'}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3.5 flex flex-col justify-between">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-[var(--text-muted)]">
                  Wispr Voice Capture
                </span>
                {activeModeLabel && (
                  <span className="inline-flex items-center gap-1 font-[family-name:var(--font-mono)] text-[10px] font-bold text-[var(--status-urgent)]">
                    <span className="h-2 w-2 rounded-full bg-[var(--status-urgent)] animate-pulse" />
                    {activeModeLabel}
                  </span>
                )}
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={transcribingAudio}
                  onClick={toggleMicListening}
                  className={`inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-semibold cursor-pointer disabled:opacity-50 ${
                    listening
                      ? 'bg-[var(--status-urgent)] text-white'
                      : 'bg-[var(--brand-primary)] text-[var(--brand-primary-fg)]'
                  }`}
                >
                  {listening ? (
                    <>
                      <Square className="h-4 w-4" aria-hidden="true" />
                      <span>Stop Wispr Mic</span>
                    </>
                  ) : transcribingAudio ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      <span>Transcribing…</span>
                    </>
                  ) : (
                    <>
                      <Mic className="h-4 w-4" aria-hidden="true" />
                      <span>Start Wispr Mic</span>
                    </>
                  )}
                </button>

                <label className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-xs font-semibold cursor-pointer hover:bg-[var(--bg-elevated)]">
                  <FileAudio className="h-4 w-4" aria-hidden="true" />
                  <span>Audio Clip</span>
                  <input
                    type="file"
                    accept="audio/*"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void transcribeAudioWithWispr(f, false);
                    }}
                  />
                </label>
              </div>

              {/* Wispr 16-bar equalizer visualizer */}
              <div
                aria-hidden="true"
                className="mt-2.5 flex h-6 items-end justify-between gap-1 rounded-lg bg-[var(--bg-surface)] px-2 py-1"
              >
                {BAR_INDICES.map((i) => (
                  <span
                    key={i}
                    className={`w-1.5 rounded-full transition-all duration-100 ${
                      listening ? 'bg-[var(--brand-primary)]' : 'bg-[var(--border-subtle)]'
                    }`}
                    style={{ height: `${Math.round((audioLevels[i] ?? 0.14) * 100)}%` }}
                  />
                ))}
              </div>
              {voiceHint && <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">{voiceHint}</p>}
            </div>
          </div>

          {/* Speaker Lock + Continuous OPD Loop + Auto-draft */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3.5 py-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold text-[var(--text-muted)] mr-1">Who Is Speaking:</span>
              {(
                [
                  { id: 'auto', label: 'Auto-Detect (Doctor ↔ Patient)' },
                  { id: 'doctor', label: 'Doctor' },
                  { id: 'patient', label: 'Patient' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSpeakerLock(opt.id)}
                  className={`min-h-9 rounded-lg px-2.5 text-xs font-semibold cursor-pointer ${
                    speakerLock === opt.id
                      ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-fg)]'
                      : 'border border-[var(--border-subtle)] bg-[var(--bg-surface)]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <label className="inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={continuousOpd}
                  onChange={(e) => setContinuousOpd(e.target.checked)}
                  className="h-4 w-4 accent-[var(--brand-primary)]"
                />
                <span>Continuous Wispr turn loop</span>
              </label>
              <label className="inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoGenerateLive}
                  onChange={(e) => setAutoGenerateLive(e.target.checked)}
                  className="h-4 w-4 accent-[var(--brand-primary)]"
                />
                <span>Auto-update SOAP &amp; Rx live</span>
              </label>
            </div>
          </div>

          {/* Live Speaker-Diarized Doctor ↔ Patient Conversation Stream */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[var(--text-muted)]">
                Live Doctor ↔ Patient Conversation Feed ({turns.length} turn{turns.length === 1 ? '' : 's'})
              </span>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowRawTranscript((v) => !v)}
                  className="text-xs font-semibold text-[var(--brand-accent-text)] hover:underline cursor-pointer"
                >
                  {showRawTranscript ? 'Hide Raw Transcript' : 'Edit Raw Transcript'}
                </button>
                {turns.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setTurns([]);
                      setTranscript('');
                    }}
                    className="text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--status-urgent)] cursor-pointer"
                  >
                    Clear Conversation
                  </button>
                )}
              </div>
            </div>

            <div
              role="region"
              aria-label="Live consultation conversation stream"
              className="max-h-72 overflow-y-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3.5 space-y-2.5"
            >
              {turns.length === 0 && !interimText ? (
                <p className="py-4 text-center text-xs text-[var(--text-muted)]">
                  Click <strong>Start Wispr Mic</strong>, speak a mixed consultation phrase, or load a Sample OPD Consultation below — Wispr transcribes on pause and tags <strong>Doctor</strong> vs <strong>Patient</strong> automatically.
                </p>
              ) : (
                <>
                  {turns.map((t) => {
                    const isDoc = t.speaker === 'doctor';
                    return (
                      <div
                        key={t.id}
                        className={`rounded-xl border p-3 text-xs ${
                          isDoc
                            ? 'border-[var(--brand-primary)]/40 bg-[var(--bg-mint-panel)]/50'
                            : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => swapTurnSpeaker(t.id)}
                              title="Click to switch Doctor / Patient"
                              className={`inline-flex min-h-7 items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase cursor-pointer ${
                                isDoc
                                  ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-fg)]'
                                  : 'bg-[var(--status-stable)] text-white'
                              }`}
                            >
                              {isDoc ? (
                                <Stethoscope className="h-3 w-3" aria-hidden="true" />
                              ) : (
                                <UserRound className="h-3 w-3" aria-hidden="true" />
                              )}
                              <span>{isDoc ? 'Doctor' : 'Patient'}</span>
                              <ArrowLeftRight className="h-2.5 w-2.5 opacity-80" aria-hidden="true" />
                            </button>
                            <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px] font-semibold">
                              {t.languageHint}
                            </span>
                            <span className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--text-muted)]">
                              {Math.round(t.confidence * 100)}%
                              {t.reasons[0] ? ` · ${t.reasons[0]}` : ''}
                            </span>
                          </div>
                          <button
                            type="button"
                            aria-label={`Delete turn: ${t.text.slice(0, 24)}`}
                            onClick={() => deleteTurn(t.id)}
                            className="inline-flex min-h-7 min-w-7 items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--status-urgent)] cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                        <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-primary)]">
                          {t.text}
                        </p>
                      </div>
                    );
                  })}

                  {interimText && (
                    <div className="rounded-xl border border-dashed border-[var(--brand-primary)] bg-[var(--bg-surface)] p-3 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-[var(--brand-rail-active)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--brand-rail-active-fg)]">
                          Wispr live · Likely{' '}
                          {interimPrediction?.speaker === 'doctor' ? 'Doctor' : 'Patient'}
                        </span>
                        <span className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--text-muted)]">
                          {interimPrediction?.languageHint ?? 'EN'}
                        </span>
                      </div>
                      <p className="mt-1 text-sm italic text-[var(--text-muted)]">{interimText}…</p>
                    </div>
                  )}
                  <div ref={feedEndRef} />
                </>
              )}
            </div>

            {(liveCues.symptoms.length > 0 ||
              liveCues.vitals.length > 0 ||
              liveCues.medicines.length > 0 ||
              liveCues.redFlags.length > 0) && (
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 text-xs space-y-1.5">
                <span className="block font-bold uppercase tracking-wide text-[10px] text-[var(--brand-accent-text)]">
                  Instant Live Extraction Preview
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {liveCues.redFlags.map((rf) => (
                    <span
                      key={rf}
                      className="rounded-full bg-[var(--status-urgent-bg)] px-2.5 py-0.5 font-semibold text-[var(--status-urgent)]"
                    >
                      RED FLAG: {rf}
                    </span>
                  ))}
                  {liveCues.symptoms.map((sym) => (
                    <span
                      key={sym}
                      className="rounded-full bg-[var(--status-watch-bg)] px-2.5 py-0.5 font-medium text-[var(--status-watch)]"
                    >
                      Symptom: {sym}
                    </span>
                  ))}
                  {liveCues.vitals.map((v) => (
                    <span
                      key={v}
                      className="rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] px-2.5 py-0.5 font-[family-name:var(--font-mono)]"
                    >
                      {v}
                    </span>
                  ))}
                  {liveCues.medicines.map((m) => (
                    <span
                      key={m}
                      className="rounded-full bg-[var(--status-stable-bg)] px-2.5 py-0.5 font-semibold text-[var(--status-stable)]"
                    >
                      Rx: {m}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <form onSubmit={handleQuickTurnSubmit} className="flex flex-wrap gap-2">
              <input
                type="text"
                aria-label="Add or speak a consultation line"
                value={quickUtterance}
                onChange={(e) => setQuickUtterance(e.target.value)}
                placeholder='Add a live sentence in EN/KN/HI (auto-detects Doctor vs Patient), e.g. "3 days inda jwara ide" or "Take Dolo 650 mg 1-0-1 after food"'
                className="min-h-11 flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-xs"
              />
              <button
                type="submit"
                disabled={!quickUtterance.trim()}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 text-xs font-semibold cursor-pointer disabled:opacity-40 hover:bg-[var(--bg-elevated)]"
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Add Turn</span>
              </button>
            </form>
          </div>

          {/* Sample Vignettes for Quick OPD Testing */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-[var(--text-muted)]">Sample OPD Consultations:</span>
            {(scribeQuery.data?.sampleScenarios ?? []).map((sc) => (
              <button
                key={sc.id}
                type="button"
                onClick={() => {
                  setLanguageMix(sc.languageMix);
                  if (patientMode === 'walkin') setWalkinLabel(sc.patientLabel);
                  const parsed = parseTranscriptIntoTurns(sc.transcript);
                  setTurns(parsed);
                  setTranscript(formatTurnsToTranscript(parsed));
                  setStatusBanner(
                    `Loaded diarized sample conversation (${parsed.length} Doctor/Patient turns): ${sc.label}`,
                  );
                }}
                className="min-h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--bg-elevated)] cursor-pointer"
              >
                {sc.label}
              </button>
            ))}
          </div>

          {showRawTranscript && (
            <div>
              <label htmlFor="opd-transcript-box" className="block text-xs font-semibold text-[var(--text-muted)]">
                Raw / Speaker-Tagged Transcript (synced with conversation turns above)
              </label>
              <textarea
                id="opd-transcript-box"
                rows={4}
                value={transcript}
                onChange={(e) => {
                  setTranscript(e.target.value);
                  setTurns(parseTranscriptIntoTurns(e.target.value));
                }}
                className="mt-1.5 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 font-[family-name:var(--font-mono)] text-xs leading-relaxed"
              />
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-[var(--text-muted)]">
              {turns.length > 0
                ? `${turns.filter((t) => t.speaker === 'doctor').length} Doctor · ${turns.filter((t) => t.speaker === 'patient').length} Patient turn(s)`
                : listening
                  ? 'Wispr listening active…'
                  : 'Ready for Wispr live mic, audio clip, or sample consultation'}
            </span>
            <button
              type="button"
              disabled={generateMutation.isPending || transcript.trim().length < 8}
              onClick={() => generateMutation.mutate(transcript)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-5 text-sm font-semibold text-[var(--brand-primary-fg)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generateMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              )}
              <span>
                {generateMutation.isPending
                  ? 'Structuring Note & Rx…'
                  : 'Generate Clinical Note, Rx & Summary'}
              </span>
            </button>
          </div>
        </div>
      </section>

      {/* Structured Clinical Outputs for Doctor Editing & Approval */}
      {soapNote && patientSummary && (
        <div className="space-y-6">
          <section className="mint-bento p-4 sm:p-5">
            <div className="clinical-card p-5 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-3 py-0.5 text-xs font-bold uppercase ${
                        activeStatus === 'approved'
                          ? 'bg-[var(--status-stable-bg)] text-[var(--status-stable)]'
                          : 'bg-[var(--status-watch-bg)] text-[var(--status-watch)]'
                      }`}
                    >
                      {activeStatus === 'approved'
                        ? 'Approved & Signed ✓'
                        : 'Draft · Awaiting Doctor Approval'}
                    </span>
                    <span className="font-[family-name:var(--font-mono)] text-xs text-[var(--text-muted)]">
                      {activeGenerator}
                    </span>
                    {soapNote.languagesDetected.length > 0 && (
                      <span className="rounded-full border border-[var(--border-subtle)] px-2.5 py-0.5 text-xs font-medium">
                        {soapNote.languagesDetected.join(' + ')}
                      </span>
                    )}
                  </div>
                  <h3 className="mt-2 font-[family-name:var(--font-display)] text-lg font-bold">
                    Review Structured OPD Output Before Signing
                  </h3>
                </div>

                <div className="flex flex-wrap items-center gap-2 print:hidden">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3.5 text-xs font-semibold hover:bg-[var(--bg-elevated)] cursor-pointer"
                  >
                    <Printer className="h-4 w-4" aria-hidden="true" />
                    <span>Print Rx &amp; Summary</span>
                  </button>
                  <button
                    type="button"
                    disabled={approveMutation.isPending}
                    onClick={() => approveMutation.mutate()}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-[var(--status-stable)] px-4 text-xs font-semibold text-white cursor-pointer disabled:opacity-50"
                  >
                    {approveMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                    )}
                    <span>
                      {approveMutation.isPending
                        ? 'Signing…'
                        : activeStatus === 'approved'
                          ? 'Update Signed Record'
                          : 'Approve & Sign Consultation'}
                    </span>
                  </button>
                </div>
              </div>

              {soapNote.redFlags.length > 0 && (
                <div className="rounded-xl border border-[var(--status-urgent)] bg-[var(--status-urgent-bg)] p-3 text-xs font-semibold text-[var(--status-urgent)] flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>Clinical Red Flags Detected: {soapNote.redFlags.join(' · ')}</span>
                </div>
              )}

              <div className="grid gap-6 lg:grid-cols-12">
                {/* Left 6 cols: SOAP Clinical Note */}
                <div className="space-y-3 lg:col-span-6">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
                    <h4 className="font-[family-name:var(--font-display)] text-base font-bold">
                      1. Structured SOAP Clinical Note
                    </h4>
                  </div>

                  <div>
                    <label htmlFor="soap-cc" className="block text-xs font-semibold text-[var(--text-muted)]">
                      Chief Complaint
                    </label>
                    <input
                      id="soap-cc"
                      type="text"
                      value={soapNote.chiefComplaint}
                      onChange={(e) => setSoapNote({ ...soapNote, chiefComplaint: e.target.value })}
                      className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-sm font-medium"
                    />
                  </div>

                  <div>
                    <label htmlFor="soap-hpi" className="block text-xs font-semibold text-[var(--text-muted)]">
                      Subjective / History of Present Illness (Patient-Attributed)
                    </label>
                    <textarea
                      id="soap-hpi"
                      rows={3}
                      value={soapNote.subjectiveHpi}
                      onChange={(e) => setSoapNote({ ...soapNote, subjectiveHpi: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2.5 text-xs"
                    />
                  </div>

                  <div>
                    <label htmlFor="soap-obj" className="block text-xs font-semibold text-[var(--text-muted)]">
                      Objective Exam &amp; Grounded Telemetry
                    </label>
                    <textarea
                      id="soap-obj"
                      rows={3}
                      value={soapNote.objectiveExam}
                      onChange={(e) => setSoapNote({ ...soapNote, objectiveExam: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2.5 text-xs"
                    />
                  </div>

                  <div>
                    <label htmlFor="soap-assess" className="block text-xs font-semibold text-[var(--text-muted)]">
                      Clinical Assessment / Working Impression
                    </label>
                    <textarea
                      id="soap-assess"
                      rows={2}
                      value={soapNote.assessment}
                      onChange={(e) => setSoapNote({ ...soapNote, assessment: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2.5 text-xs font-medium"
                    />
                  </div>

                  <div>
                    <label htmlFor="soap-plan" className="block text-xs font-semibold text-[var(--text-muted)]">
                      Plan, Investigations &amp; Follow-up
                    </label>
                    <textarea
                      id="soap-plan"
                      rows={3}
                      value={soapNote.planAndFollowUp}
                      onChange={(e) => setSoapNote({ ...soapNote, planAndFollowUp: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2.5 text-xs"
                    />
                  </div>
                </div>

                {/* Right 6 cols: Draft Prescription + Bilingual Patient Summary */}
                <div className="space-y-4 lg:col-span-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Pill className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
                      <h4 className="font-[family-name:var(--font-display)] text-base font-bold">
                        2. Draft Prescription (Rx)
                      </h4>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setRxDraft([
                          ...rxDraft,
                          {
                            drugName: '',
                            strength: '500 mg',
                            route: 'Oral',
                            frequency: '1-0-1 (BD)',
                            timing: 'After food',
                            durationDays: 5,
                            instructions: 'Take as directed',
                            rxcui: null,
                            affectsHeartRate: false,
                          },
                        ])
                      }
                      className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 text-xs font-semibold cursor-pointer print:hidden"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Add Medicine</span>
                    </button>
                  </div>

                  {rxDraft.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-[var(--border-subtle)] p-3 text-xs text-[var(--text-muted)]">
                      No medicines extracted yet. Dictate or add prescription items before signing.
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      {rxDraft.map((item, idx) => (
                        <div
                          key={`${idx}-${item.drugName}`}
                          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <input
                              aria-label={`Medicine ${idx + 1} name`}
                              type="text"
                              value={item.drugName}
                              placeholder="Drug name (e.g. Paracetamol)"
                              onChange={(e) => {
                                const next = [...rxDraft];
                                next[idx] = { ...item, drugName: e.target.value, rxcui: null };
                                setRxDraft(next);
                              }}
                              className="min-h-9 flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 text-xs font-bold"
                            />
                            {item.rxcui && (
                              <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px]">
                                RxCUI:{item.rxcui}
                              </span>
                            )}
                            {item.affectsHeartRate && (
                              <span className="rounded-full bg-[var(--status-watch-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--status-watch)]">
                                HR-Modifying
                              </span>
                            )}
                            <button
                              type="button"
                              aria-label={`Remove medicine ${idx + 1}`}
                              onClick={() => setRxDraft(rxDraft.filter((_, i) => i !== idx))}
                              className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-[var(--border-subtle)] text-[var(--status-urgent)] cursor-pointer print:hidden"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <input
                              aria-label={`Medicine ${idx + 1} strength`}
                              type="text"
                              value={item.strength}
                              onChange={(e) => {
                                const next = [...rxDraft];
                                next[idx] = { ...item, strength: e.target.value };
                                setRxDraft(next);
                              }}
                              className="min-h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-xs"
                            />
                            <input
                              aria-label={`Medicine ${idx + 1} frequency`}
                              type="text"
                              value={item.frequency}
                              onChange={(e) => {
                                const next = [...rxDraft];
                                next[idx] = { ...item, frequency: e.target.value };
                                setRxDraft(next);
                              }}
                              className="min-h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-xs font-[family-name:var(--font-mono)]"
                            />
                            <input
                              aria-label={`Medicine ${idx + 1} timing`}
                              type="text"
                              value={item.timing}
                              onChange={(e) => {
                                const next = [...rxDraft];
                                next[idx] = { ...item, timing: e.target.value };
                                setRxDraft(next);
                              }}
                              className="min-h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-xs"
                            />
                            <div className="flex items-center gap-1">
                              <input
                                aria-label={`Medicine ${idx + 1} days`}
                                type="number"
                                min={1}
                                max={180}
                                value={item.durationDays}
                                onChange={(e) => {
                                  const next = [...rxDraft];
                                  next[idx] = {
                                    ...item,
                                    durationDays: Math.max(1, Number(e.target.value) || 1),
                                  };
                                  setRxDraft(next);
                                }}
                                className="min-h-9 w-16 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-xs"
                              />
                              <span className="text-[11px] text-[var(--text-muted)]">days</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {effectivePatientId && (
                    <label className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)] print:hidden">
                      <input
                        type="checkbox"
                        checked={syncMedications}
                        onChange={(e) => setSyncMedications(e.target.checked)}
                        className="h-4 w-4 accent-[var(--brand-primary)]"
                      />
                      <span>
                        Sync approved medicines to linked patient&apos;s active SENTINEL medication list
                      </span>
                    </label>
                  )}

                  {/* Patient Summary Sheet */}
                  <div className="pt-2 border-t border-[var(--border-subtle)] space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="font-[family-name:var(--font-display)] text-base font-bold">
                        3. Patient Summary Sheet
                      </h4>
                      <div className="flex items-center gap-1.5 print:hidden">
                        {(['en', 'kn', 'hi'] as const).map((lang) => (
                          <button
                            key={lang}
                            type="button"
                            onClick={() => setSummaryLangTab(lang)}
                            className={`min-h-9 rounded-lg px-2.5 text-xs font-semibold cursor-pointer ${
                              summaryLangTab === lang
                                ? 'bg-[var(--brand-rail-active)] text-[var(--brand-rail-active-fg)]'
                                : 'border border-[var(--border-subtle)] bg-[var(--bg-base)]'
                            }`}
                          >
                            {lang === 'en' ? 'English' : lang === 'kn' ? 'ಕನ್ನಡ' : 'हिन्दी'}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() =>
                            speakSummary(summaryLangTab, patientSummary[summaryLangTab])
                          }
                          className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 text-xs font-semibold cursor-pointer"
                        >
                          <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Read Aloud</span>
                        </button>
                      </div>
                    </div>
                    <textarea
                      aria-label={`Patient summary in ${summaryLangTab}`}
                      rows={6}
                      value={patientSummary[summaryLangTab]}
                      onChange={(e) =>
                        setPatientSummary({
                          ...patientSummary,
                          [summaryLangTab]: e.target.value,
                        })
                      }
                      className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 text-xs leading-relaxed"
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Recent OPD Consultations Queue / History */}
      <section className="mint-bento p-4 sm:p-5 print:hidden">
        <div className="clinical-card p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
              <h3 className="font-[family-name:var(--font-display)] text-base font-bold">
                Recent OPD Scribe Consultations
              </h3>
            </div>
            <span className="text-xs text-[var(--text-muted)]">
              {(scribeQuery.data?.consultations ?? []).length} saved
            </span>
          </div>

          {(scribeQuery.data?.consultations ?? []).length === 0 ? (
            <p className="mt-3 text-xs text-[var(--text-muted)]">
              No OPD consultations generated yet. Click Start Wispr Mic or load a sample consultation above.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {(scribeQuery.data?.consultations ?? []).slice(0, 8).map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{c.patientLabel}</span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          c.status === 'approved'
                            ? 'bg-[var(--status-stable-bg)] text-[var(--status-stable)]'
                            : 'bg-[var(--status-watch-bg)] text-[var(--status-watch)]'
                        }`}
                      >
                        {c.status === 'approved' && (
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                        )}
                        {c.status}
                      </span>
                      <span className="font-[family-name:var(--font-mono)] text-[var(--text-muted)]">
                        {c.prescriptionDraft.length} Rx item(s)
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[var(--text-muted)]">
                      {c.soapNote.chiefComplaint}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => loadConsultation(c)}
                      className="min-h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-xs font-semibold cursor-pointer hover:bg-[var(--bg-elevated)]"
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete consultation ${c.patientLabel}`}
                      onClick={() => deleteMutation.mutate(c.id)}
                      className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--status-urgent)] cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
