'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Send, Square } from 'lucide-react';

interface VoiceCheckinProps {
  patientId?: string;
  locale: 'en' | 'kn' | 'hi';
  isSynthetic?: boolean;
  onRecorded: () => void;
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
  const [rmsLevel, setRmsLevel] = useState(0);
  const [reply, setReply] = useState<string | null>(null);
  const [redFlagTriggered, setRedFlagTriggered] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

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
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
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
    if (listening) {
      setListening(false);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      setRmsLevel(0);
      return;
    }

    // Optional mic VAD meter if browser allows microphone
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const AudioCtx = window.AudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          const src = ctx.createMediaStreamSource(stream);
          src.connect(analyser);
          const buf = new Uint8Array(analyser.frequencyBinCount);
          const sample = () => {
            analyser.getByteTimeDomainData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i += 1) {
              const v = ((buf[i] ?? 128) - 128) / 128;
              sum += v * v;
            }
            setRmsLevel(Math.min(100, Math.round(Math.sqrt(sum / buf.length) * 300)));
            rafRef.current = requestAnimationFrame(sample);
          };
          sample();
        }
      } catch {
        // Text/tap fallback remains active
      }
    }

    const WinSpeech = (
      window as unknown as {
        SpeechRecognition?: new () => {
          lang: string;
          interimResults: boolean;
          onresult: (ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
          onend: () => void;
          start: () => void;
        };
        webkitSpeechRecognition?: new () => {
          lang: string;
          interimResults: boolean;
          onresult: (ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
          onend: () => void;
          start: () => void;
        };
      }
    ).SpeechRecognition ??
      (
        window as unknown as {
          webkitSpeechRecognition?: new () => {
            lang: string;
            interimResults: boolean;
            onresult: (ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
            onend: () => void;
            start: () => void;
          };
        }
      ).webkitSpeechRecognition;

    setListening(true);
    if (WinSpeech) {
      const recog = new WinSpeech();
      recog.lang = locale === 'kn' ? 'kn-IN' : locale === 'hi' ? 'hi-IN' : 'en-IN';
      recog.interimResults = false;
      recog.onresult = (ev) => {
        const text = ev.results[0]?.[0]?.transcript ?? '';
        if (text) setTranscript(text);
      };
      recog.onend = () => setListening(false);
      recog.start();
    }
  }

  async function submitVoiceText(textToSubmit: string) {
    const clean = textToSubmit.trim();
    if (!clean) return;
    setSubmitting(true);
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
        analysis: { replyText: string; redFlag: boolean; symptoms: string[] };
      };
      if (res.ok && body.analysis) {
        setReply(body.analysis.replyText);
        setRedFlagTriggered(body.analysis.redFlag);
        speakText(body.analysis.replyText);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'sentinel_reply', text: body.analysis.replyText }));
        }
        onRecorded();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      aria-label="Voice Companion Check-In"
      className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">Voice Check-In Companion</h2>
          <p className="text-sm text-[var(--text-muted)]">
            Speak or type how you feel in English, Kannada, or Hindi.{' '}
            {wsConnected ? '(Open-LLM-VTuber WS connected)' : '(Browser Web Audio / Text Fallback)'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleMicListening}
            className={`inline-flex min-h-12 items-center gap-2 rounded-xl border px-4 text-base font-semibold cursor-pointer ${
              listening
                ? 'border-[var(--status-urgent)] bg-[var(--status-urgent-bg)] text-[var(--status-urgent)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-base)]'
            }`}
          >
            {listening ? <MicOff className="h-5 w-5" aria-hidden="true" /> : <Mic className="h-5 w-5" aria-hidden="true" />}
            <span>{listening ? `Stop Mic (${rmsLevel}%)` : 'Speak'}</span>
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
              submitVoiceText(phrase);
            }}
            className="min-h-11 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3.5 text-sm font-semibold hover:bg-[var(--bg-elevated)] cursor-pointer"
          >
            &ldquo;{phrase}&rdquo;
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <label htmlFor="voice-transcript-input" className="sr-only">
          Voice transcript input
        </label>
        <input
          id="voice-transcript-input"
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder="Say or type e.g. 'I feel dizzy today'..."
          className="min-h-12 min-w-0 flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 text-base"
        />
        <button
          type="button"
          onClick={() => submitVoiceText(transcript)}
          disabled={submitting || !transcript.trim()}
          className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-5 text-base font-semibold text-[var(--brand-primary-fg)] cursor-pointer"
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
