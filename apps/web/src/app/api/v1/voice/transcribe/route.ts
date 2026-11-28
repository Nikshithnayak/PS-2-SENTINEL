import { NextResponse, type NextRequest } from 'next/server';
import { requireSession } from '@/lib/session';
import { cleanSpokenTranscript } from '@/lib/voice/transcript-cleaner';

interface ServerSttProvider {
  kind: 'groq' | 'local_whisper' | 'openai';
  label: string;
  endpoint: string;
  apiKey?: string;
  model: string;
}

function resolveServerSttProvider(env: NodeJS.ProcessEnv = process.env): ServerSttProvider | null {
  const groqKey = env.GROQ_API_KEY?.trim();
  if (groqKey) {
    return {
      kind: 'groq',
      label: 'Groq Whisper Large v3 Turbo (Free Tier)',
      endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
      apiKey: groqKey,
      model: env.GROQ_WHISPER_MODEL?.trim() || 'whisper-large-v3-turbo',
    };
  }

  const localUrl = env.WHISPER_LOCAL_URL?.trim();
  if (localUrl) {
    return {
      kind: 'local_whisper',
      label: 'Local Open-Source Whisper Server',
      endpoint: `${localUrl.replace(/\/$/, '')}/v1/audio/transcriptions`,
      apiKey: env.WHISPER_LOCAL_API_KEY?.trim() || undefined,
      model: env.WHISPER_LOCAL_MODEL?.trim() || 'Systran/faster-whisper-small',
    };
  }

  const openaiKey = env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    return {
      kind: 'openai',
      label: 'OpenAI Whisper',
      endpoint: 'https://api.openai.com/v1/audio/transcriptions',
      apiKey: openaiKey,
      model: 'whisper-1',
    };
  }

  return null;
}

export async function GET() {
  const provider = resolveServerSttProvider();
  return NextResponse.json({
    serverWhisperAvailable: Boolean(provider),
    providerKind: provider?.kind ?? 'browser_local_whisper',
    providerLabel: provider?.label ?? 'In-Browser Open-Source Whisper (Xenova/whisper-base)',
  });
}

export async function POST(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;

  const provider = resolveServerSttProvider();
  if (!provider) {
    return NextResponse.json(
      {
        error:
          'No server Whisper provider configured (GROQ_API_KEY / WHISPER_LOCAL_URL). Use on-device browser Whisper.',
        fallback: 'browser_whisper',
      },
      { status: 501 },
    );
  }

  const formData = await request.formData().catch(() => null);
  const audioFile = formData?.get('audio');
  if (!audioFile || !(audioFile instanceof Blob) || audioFile.size === 0) {
    return NextResponse.json({ error: 'Non-empty audio blob is required' }, { status: 400 });
  }
  if (audioFile.size > 15 * 1024 * 1024) {
    return NextResponse.json({ error: 'Audio clip exceeds 15MB limit' }, { status: 413 });
  }

  const localeRaw = String(formData?.get('locale') ?? 'en');
  const modeRaw = String(formData?.get('mode') ?? 'checkin');
  const language =
    localeRaw === 'mixed'
      ? null
      : localeRaw === 'kn'
        ? 'kn'
        : localeRaw === 'hi'
          ? 'hi'
          : 'en';

  const promptHint =
    modeRaw === 'opd_ambient'
      ? 'Indian OPD doctor-patient consultation in code-mixed English, Kannada, and Hindi: jwara, bukhar, keemu, khansi, breathlessness, usirata, saans, BP, sugar, SpO2, Paracetamol, Dolo 650, Azithromycin, Amoxyclav, Pantoprazole, Metformin, Telmisartan, Amlodipine, BD, OD, TDS, SOS, after food.'
      : 'Health check-in conversation: vitals, heart rate, SpO2, BP, fever, dizziness, knee pain, medications, Sachet SENTINEL.';

  const upstreamForm = new FormData();
  upstreamForm.append('file', audioFile, 'checkin.webm');
  upstreamForm.append('model', provider.model);
  if (language) {
    upstreamForm.append('language', language);
  }
  upstreamForm.append('response_format', 'json');
  upstreamForm.append('prompt', promptHint);

  const headers: Record<string, string> = {};
  if (provider.apiKey) {
    headers.Authorization = `Bearer ${provider.apiKey}`;
  }

  try {
    const res = await fetch(provider.endpoint, {
      method: 'POST',
      headers,
      body: upstreamForm,
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `Whisper transcription HTTP ${res.status}`, detail: errText.slice(0, 200) },
        { status: 502 },
      );
    }

    const body = (await res.json()) as { text?: string };
    const cleaned = cleanSpokenTranscript(body.text ?? '');
    return NextResponse.json({
      text: cleaned,
      rawText: body.text ?? '',
      provider: provider.kind,
      model: provider.model,
    });
  } catch {
    return NextResponse.json(
      { error: 'Server Whisper transcription timed out', fallback: 'browser_whisper' },
      { status: 504 },
    );
  }
}
