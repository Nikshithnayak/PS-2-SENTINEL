'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Send, Square } from 'lucide-react';

interface VoiceCheckinProps {
  patientId?: string;
  locale: 'en' | 'kn' | 'hi';
  isSynthetic?: boolean;
  onRecorded: () => void;
}

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

function resolveSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

function mapSpeechErrorMessage(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone permission was blocked. Allow microphone access in your browser site settings, or type your check-in below.';
    case 'no-speech':
      return 'No speech was detected. Tap Speak and speak clearly near your microphone, or type below.';
    case 'audio-capture':
      return 'No working microphone was detected on this device. Please type your check-in below.';
    case 'network':
      return 'Browser speech transcription needs an internet connection. Check your network or type below.';
    case 'language-not-supported':
      return 'Selected language voice transcription is unavailable in this browser; try English or type below.';
    case 'aborted':
      return '';
    default:
      return `Voice transcription stopped (${code}). You can type or tap a quick phrase below.`;
  }
}

export function VoiceCheckinCompanion({
  patientId,
  locale,
  isSynthetic = false,
  onRecorded,
}: VoiceCheckinProps) {
  const [transcript, setTranscript] = useState('');
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceHint, setVoiceHint] = useState<string | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [redFlagTriggered, setRedFlagTriggered] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const capturedFinalRef = useRef<string>('');
  const manualStopRef = useRef(false);

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

  useEffect(() => {
    return () => {
      manualStopRef.current = true;
      try {
        recognitionRef.current?.abort();
      } catch {
        // Ignore cleanup abort errors
      }
    };
  }, []);

  function bargeInStop() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  }

  function speakText(text: string) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = locale === 'kn' ? 'kn-IN' : locale === 'hi' ? 'hi-IN' : 'en-IN';
    utter.rate = 0.92;
    utter.onstart = () => setSpeaking(true);
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utter);
  }

  async function toggleMicListening() {
    bargeInStop();
    setVoiceError(null);
    setVoiceHint(null);

    if (listening) {
      manualStopRef.current = true;
      try {
        recognitionRef.current?.stop();
      } catch {
        setListening(false);
      }
      return;
    }

    const SpeechCtor = resolveSpeechRecognition();
    if (!SpeechCtor) {
      setVoiceError(
        'Live speech transcription is not supported in this browser. Use Chrome/Edge/Android Chrome, tap a quick phrase, or type below.',
      );
      return;
    }

    try {
      const recog = new SpeechCtor();
      recognitionRef.current = recog;
      capturedFinalRef.current = '';
      manualStopRef.current = false;

      recog.lang = locale === 'kn' ? 'kn-IN' : locale === 'hi' ? 'hi-IN' : 'en-IN';
      recog.interimResults = true;
      recog.continuous = false;
      recog.maxAlternatives = 1;

      recog.onresult = (ev) => {
        let finalText = '';
        let interimText = '';
        for (let i = 0; i < ev.results.length; i += 1) {
          const result = ev.results[i];
          if (!result) continue;
          const text = result[0]?.transcript ?? '';
          if (!text) continue;
          if (result.isFinal) {
            finalText += `${text} `;
          } else {
            interimText += `${text} `;
          }
        }
        const combined = `${finalText}${interimText}`.trim();
        if (combined) {
          setTranscript(combined);
        }
        if (finalText.trim()) {
          capturedFinalRef.current = finalText.trim();
        }
      };

      recog.onerror = (ev) => {
        setListening(false);
        const msg = mapSpeechErrorMessage(ev.error);
        if (msg) setVoiceError(msg);
      };

      recog.onend = () => {
        setListening(false);
        recognitionRef.current = null;
        const finalClean = capturedFinalRef.current.trim();
        if (finalClean && !manualStopRef.current) {
          setVoiceHint(`Transcribed "${finalClean}" — sending check-in...`);
          void submitVoiceText(finalClean);
        } else if (!finalClean && transcript.trim() && !manualStopRef.current) {
          setVoiceHint('Speech captured in the text box — tap Send Voice Note to submit.');
        }
      };

      setListening(true);
      setVoiceHint('Listening... speak naturally now.');
      recog.start();
    } catch (err) {
      setListening(false);
      setVoiceError(
        err instanceof Error
          ? err.message
          : 'Could not start speech transcription. Allow mic access or type below.',
      );
    }
  }

  async function submitVoiceText(textToSubmit: string) {
    const clean = textToSubmit.trim();
    if (!clean) return;
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
        }),
      });
      const body = (await res.json()) as {
        error?: string;
        analysis?: { replyText: string; redFlag: boolean; symptoms: string[] };
      };
      if (res.ok && body.analysis) {
        setReply(body.analysis.replyText);
        setRedFlagTriggered(body.analysis.redFlag);
        setVoiceHint(null);
        speakText(body.analysis.replyText);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({ type: 'sentinel_reply', text: body.analysis.replyText }),
          );
        }
        onRecorded();
      } else {
        setVoiceError(body.error ?? 'Could not save voice check-in.');
      }
    } catch {
      setVoiceError('Network error sending voice check-in.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      aria-label="Voice Companion Check-In"
      className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">Voice Check-In Companion</h2>
          <p className="text-sm text-[var(--text-muted)]">
            Tap Speak to transcribe your voice or type in English, Kannada, or Hindi.{' '}
            {wsConnected ? '(Open-LLM-VTuber WS connected)' : '(Live Browser Speech-to-Text)'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={toggleMicListening}
            className={`inline-flex min-h-12 items-center gap-2 rounded-xl border px-4 text-base font-semibold cursor-pointer ${
              listening
                ? 'border-[var(--status-urgent)] bg-[var(--status-urgent-bg)] text-[var(--status-urgent)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-base)] hover:bg-[var(--bg-elevated)]'
            }`}
          >
            {listening ? (
              <MicOff className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Mic className="h-5 w-5 text-[var(--brand-primary)]" aria-hidden="true" />
            )}
            <span>{listening ? 'Stop Listening' : 'Speak'}</span>
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

      <div className="mt-4 flex flex-wrap gap-2">
        {[
          'I feel okay today',
          'Feeling dizzy and feverish',
          'Short of breath and chest tightness',
        ].map((phrase) => (
          <button
            key={phrase}
            type="button"
            onClick={() => {
              setTranscript(phrase);
              void submitVoiceText(phrase);
            }}
            className="min-h-11 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3.5 text-sm font-semibold hover:bg-[var(--bg-elevated)] cursor-pointer"
          >
            &ldquo;{phrase}&rdquo;
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="voice-transcript-input" className="sr-only">
          Voice transcript input
        </label>
        <input
          id="voice-transcript-input"
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder="Tap Speak or type e.g. 'I feel dizzy today'..."
          className="min-h-12 min-w-0 flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 text-base"
        />
        <button
          type="button"
          onClick={() => void submitVoiceText(transcript)}
          disabled={submitting || !transcript.trim()}
          className="inline-flex min-h-12 w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-[var(--brand-primary)] px-5 text-base font-semibold text-[var(--brand-primary-fg)] disabled:opacity-50 cursor-pointer"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          <span>{submitting ? 'Sending...' : 'Send Voice Note'}</span>
        </button>
      </div>

      {reply && (
        <div
          data-testid="voice-companion-reply"
          role={redFlagTriggered ? 'alert' : 'status'}
          className={`mt-4 rounded-2xl border p-4 text-base font-medium ${
            redFlagTriggered
              ? 'border-[var(--status-urgent)] bg-[var(--status-urgent-bg)] text-[var(--status-urgent)]'
              : 'border-[var(--status-stable)] bg-[var(--status-stable-bg)] text-[var(--status-stable)]'
          }`}
        >
          {reply}
        </div>
      )}
    </section>
  );
}
