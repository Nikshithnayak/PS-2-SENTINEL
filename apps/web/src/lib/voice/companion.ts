import {
  analyzeVoiceCheckin,
  type VoiceCheckinAnalysis,
  type VoiceConversationContext,
} from './parser';

export interface ConversationalVoiceReplyResult {
  analysis: VoiceCheckinAnalysis;
  responderSource: 'llm' | 'conversational_nlu';
}

interface LlmEndpointConfig {
  apiKey: string | null;
  baseUrl: string;
  model: string;
}

function resolveLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmEndpointConfig | null {
  const groqKey = env.GROQ_API_KEY?.trim();
  const explicitKey = env.LLM_PHRASING_API_KEY?.trim();
  const openaiKey = env.OPENAI_API_KEY?.trim();
  const geminiKey = env.GEMINI_API_KEY?.trim();
  const ollamaUrl = env.OLLAMA_BASE_URL?.trim();

  if (explicitKey) {
    return {
      apiKey: explicitKey,
      baseUrl: (env.LLM_PHRASING_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/$/, ''),
      model: env.LLM_PHRASING_MODEL?.trim() || 'gpt-4o-mini',
    };
  }

  if (groqKey) {
    return {
      apiKey: groqKey,
      baseUrl: 'https://api.groq.com/openai/v1',
      model: env.LLM_PHRASING_MODEL?.trim() || 'openai/gpt-oss-20b',
    };
  }

  if (geminiKey) {
    return {
      apiKey: geminiKey,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: env.LLM_PHRASING_MODEL?.trim() || 'gemini-2.0-flash',
    };
  }

  if (openaiKey) {
    return {
      apiKey: openaiKey,
      baseUrl: 'https://api.openai.com/v1',
      model: env.LLM_PHRASING_MODEL?.trim() || 'gpt-4o-mini',
    };
  }

  if (ollamaUrl) {
    return {
      apiKey: null,
      baseUrl: ollamaUrl.replace(/\/$/, ''),
      model: env.LLM_PHRASING_MODEL?.trim() || 'llama3.2',
    };
  }

  return null;
}

/**
 * Combines deterministic clinical red-flag triage with natural multi-turn LLM dialogue
 * (supporting Groq free tier, Gemini free tier, local Ollama, or OpenAI-compatible endpoints)
 * and context-aware conversational NLU fallback.
 */
export async function generateConversationalVoiceReply(params: {
  transcript: string;
  locale: 'en' | 'kn' | 'hi';
  emergencyNumber: string;
  context?: VoiceConversationContext;
  conditions?: string[];
}): Promise<ConversationalVoiceReplyResult> {
  const analysis = analyzeVoiceCheckin(
    params.transcript,
    params.locale,
    params.emergencyNumber,
    params.context,
  );

  const llmCfg = resolveLlmConfig();
  // Known, safety-sensitive, and context-grounded responses should never wait
  // on an external LLM. The deterministic parser returns immediately and is
  // used for greetings, symptoms, vitals, and all clinical red flags.
  if (
    !llmCfg ||
    analysis.redFlag ||
    analysis.intent !== 'general_conversation'
  ) {
    return { analysis, responderSource: 'conversational_nlu' };
  }

  const langName =
    params.locale === 'kn' ? 'Kannada' : params.locale === 'hi' ? 'Hindi' : 'English';

  const vitalsSummary = [
    params.context?.latestLevel ? `Latest risk band: ${params.context.latestLevel}` : null,
    typeof params.context?.latestIndex === 'number'
      ? `Deterioration index: ${params.context.latestIndex}`
      : null,
    typeof params.context?.recentHeartRate === 'number'
      ? `Recent HR: ${Math.round(params.context.recentHeartRate)} bpm`
      : null,
    typeof params.context?.recentSpo2 === 'number'
      ? `Recent SpO2: ${Math.round(params.context.recentSpo2)}%`
      : null,
    params.conditions?.length ? `Health modules: ${params.conditions.join(', ')}` : null,
    params.context?.activeMeds?.length
      ? `Active medications: ${params.context.activeMeds.join(', ')}`
      : null,
  ]
    .filter(Boolean)
    .join('; ');

  const systemPrompt = [
    `You are Sachet, a warm, natural, respectful health check-in voice companion for elderly adults and their families.`,
    `Respond in natural ${langName}. Keep replies clear, warm, and concise (2 to 4 short sentences) so they sound effortless when spoken aloud, and address exactly what the user just said (greetings, questions, everyday pain, stress, sleep, diet, meds, or casual conversation).`,
    `Strict clinical safety: never invent sensor measurements not provided in context; never diagnose disease; for chest pain/tightness, trouble breathing, fainting, or stroke signs instruct sitting safely and calling Emergency ${params.emergencyNumber}.`,
    vitalsSummary ? `Grounded patient context: ${vitalsSummary}.` : `No recent watch readings synced yet.`,
  ].join(' ');

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    ...(params.context?.history ?? []).slice(-6).map((h) => ({
      role: h.role,
      content: h.text,
    })),
    { role: 'user', content: params.transcript },
  ];

  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (llmCfg.apiKey) headers.Authorization = `Bearer ${llmCfg.apiKey}`;

    const res = await fetch(`${llmCfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: llmCfg.model,
        messages,
        temperature: 0.5,
        max_tokens: 220,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return { analysis, responderSource: 'conversational_nlu' };
    }

    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const llmReply = body.choices?.[0]?.message?.content?.trim();
    if (!llmReply) {
      return { analysis, responderSource: 'conversational_nlu' };
    }

    return {
      analysis: {
        ...analysis,
        replyText: llmReply,
      },
      responderSource: 'llm',
    };
  } catch {
    return { analysis, responderSource: 'conversational_nlu' };
  }
}
