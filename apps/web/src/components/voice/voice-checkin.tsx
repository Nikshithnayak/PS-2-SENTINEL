'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  MessageSquareHeart,
  Mic,
  MicOff,
  Send,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';

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
  en: 'Hello! I am Sachet, your live voice companion. Tap Speak (or type below) to say hello, ask how your vitals look, or tell me about any discomfort or question.',
  kn: 'ನಮಸ್ಕಾರ! ನಾನು ನಿಮ್ಮ ಸಚೇತ್ ಧ್ವನಿ ಸಂಗಾತಿ. ಮಾತನಾಡಿ ಅಥವಾ ಕೆಳಗೆ ಟೈಪ್ ಮಾಡಿ — ಹಲೋ ಹೇಳಿ, ನಿಮ್ಮ ಆರೋಗ್ಯ ಮಾಹಿತಿ ಕೇಳಿ, ಅಥವಾ ಯಾವುದೇ ಸಮಸ್ಯೆಯನ್ನು ತಿಳಿಸಿ.',
  hi: 'नमस्ते! मैं सचेत, आपका लाइव वॉयस साथी हूँ। बात करने के लिए Speak दबाएं या नीचे लिखें — हैलो कहें, अपनी रीडिंग पूछें, या कोई भी परेशानी बताएं।',
};

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
      return 'Microphone permission was blocked. Allow mic access in browser settings or type below.';
    case 'no-speech':
      return 'No voice was picked up. Tap Speak again or type your message below.';
    case 'audio-capture':
      return 'No working microphone found on this device. You can type below.';
    case 'network':
      return 'Browser speech transcription requires an internet connection. Check network or type below.';
    case 'language-not-supported':
      return 'Voice recognition in this language is unavailable in this browser; try English or type below.';
    case 'aborted':
      return '';
    default:
      return `Voice capture ended (${code}). You can type or tap Speak again.`;
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
  const [listening, setListening] = useState(false);
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
  const manualStopRef = useRef(false);
  const handsFreeRef = useRef(false);
  const startListeningRef = useRef<() => void>(() => {});
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    handsFreeRef.current = handsFreeMode;
  }, [handsFreeMode]);

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

  useEffect(() => {
    return () => {
      manualStopRef.current = true;
      handsFreeRef.current = false;
      try {
        recognitionRef.current?.abort();
      } catch {
        // Ignore cleanup abort errors
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

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
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = locale === 'kn' ? 'kn-IN' : locale === 'hi' ? 'hi-IN' : 'en-IN';
    utter.rate = 0.94;
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

  function startSpeechRecognition() {
    bargeInStop();
    setVoiceError(null);
    setVoiceHint(null);

    const SpeechCtor = resolveSpeechRecognition();
    if (!SpeechCtor) {
      setVoiceError(
        'Live speech recognition needs Chrome, Edge, or Android Chrome. Type your message naturally below anytime.',
      );
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
          if (result.isFinal) finalText += `${text} `;
          else interimText += `${text} `;
        }
        const combined = `${finalText}${interimText}`.trim();
        latestInterimRef.current = combined;
        if (combined) setTranscript(combined);
        if (finalText.trim()) capturedFinalRef.current = finalText.trim();
      };

      recog.onerror = (ev) => {
        setListening(false);
        const msg = mapSpeechErrorMessage(ev.error);
        if (msg) setVoiceError(msg);
      };

      recog.onend = () => {
        setListening(false);
        recognitionRef.current = null;
        const spokenText = (capturedFinalRef.current || latestInterimRef.current).trim();
        if (spokenText && !manualStopRef.current) {
          setVoiceHint(`Heard "${spokenText}" — replying...`);
          void submitVoiceText(spokenText);
        }
      };

      setListening(true);
      setVoiceHint('Listening live — say hello or ask anything...');
      recog.start();
    } catch (err) {
      setListening(false);
      setVoiceError(
        err instanceof Error ? err.message : 'Unable to start mic transcription. Type below instead.',
      );
    }
  }

  startListeningRef.current = startSpeechRecognition;

  function toggleMicListening() {
    if (listening) {
      manualStopRef.current = true;
      setHandsFreeMode(false);
      try {
        recognitionRef.current?.stop();
      } catch {
        setListening(false);
      }
      return;
    }
    startSpeechRecognition();
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
          <div className="flex items-center gap-2">
            <MessageSquareHeart className="h-5 w-5 text-[var(--brand-primary)]" aria-hidden="true" />
            <h2 className="text-xl font-semibold">Voice Check-In Companion</h2>
          </div>
          <p className="text-sm text-[var(--text-muted)]">
            Speak or type freely in English, Kannada, or Hindi — natural real-time conversation.{' '}
            {wsConnected ? '(Open-LLM-VTuber WS live)' : '(Live Speech-to-Text + Voice Reply)'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
              if (next && !listening) startSpeechRecognition();
            }}
            aria-pressed={handsFreeMode}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold cursor-pointer ${
              handsFreeMode
                ? 'border-[var(--brand-primary)] bg-[var(--bg-mint-panel)] text-[var(--brand-accent-text)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-base)] hover:bg-[var(--bg-elevated)]'
            }`}
          >
            <span>{handsFreeMode ? 'Hands-Free Chat On' : 'Hands-Free Chat'}</span>
          </button>

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
                className={`max-w-[88%] rounded-2xl rounded-tl-sm border px-4 py-2.5 text-sm font-medium sm:text-base ${
                  msg.redFlag
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
          disabled={submitting || !transcript.trim()}
          className="inline-flex min-h-12 w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-[var(--brand-primary)] px-5 text-base font-semibold text-[var(--brand-primary-fg)] disabled:opacity-50 cursor-pointer"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          <span>{submitting ? 'Replying...' : 'Send'}</span>
        </button>
      </form>
    </section>
  );
}
