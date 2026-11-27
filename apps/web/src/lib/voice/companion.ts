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
  apiKey: string;
  baseUrl: string;
  model: string;
}

function resolveLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmEndpointConfig | null {
  const apiKey =
    env.LLM_PHRASING_API_KEY?.trim() ||
    env.OPENAI_API_KEY?.trim() ||
    env.GEMINI_API_KEY?.trim() ||
    '';
  if (!apiKey) return null;

  const isGeminiKey = Boolean(!env.LLM_PHRASING_API_KEY && !env.OPENAI_API_KEY && env.GEMINI_API_KEY);
  const baseUrl = (
    env.LLM_PHRASING_BASE_URL?.trim() ||
    (isGeminiKey
      ? 'https://generativelanguage.googleapis.com/v1beta/openai'
      : 'https://api.openai.com/v1')
  ).replace(/\/$/, '');
  const model =
    env.LLM_PHRASING_MODEL?.trim() || (isGeminiKey ? 'gemini-2.0-flash' : 'gpt-4o-mini');

  return { apiKey, baseUrl, model };
}

/**
 * Combines deterministic clinical red-flag triage with natural multi-turn LLM dialogue
 * (when configured via `LLM_PHRASING_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY`)
 * and context-aware conversational NLU fallback.
 */
export async function generateConversationalVoiceReply(params: {
  transcript: string;
  locale: 'en' | 'kn' | 'hi';
  emergencyNumber: string;
  context?: VoiceConversationContext;
  conditions?: string[];
}): Promise<ConversationalVoiceReplyResult> {
  // Always compute deterministic clinical safety & symptom rules first
  const analysis = analyzeVoiceCheckin(
    params.transcript,
    params.locale,
    params.emergencyNumber,
    params.context,
  );

  const llmCfg = resolveLlmConfig();
  if (!llmCfg) {
    return { analysis, responderSource: 'conversational_nlu' };
  }

  // Red flags always keep the explicit deterministic safety & emergency number instruction,
  // while non-red-flag turns benefit from rich real-time LLM conversation when configured.
  if (analysis.redFlag) {
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
    `You are Sachet, a warm, respectful, plain-language health check-in companion for elderly patients and their families.`,
    `Always respond in ${langName}. Keep replies concise (2 to 4 warm natural sentences), easy to understand when read aloud, and directly answer what the user just said (greetings, questions, everyday aches, sleep, stress, diet, medications, etc.).`,
    `Safety rules: Never invent vital measurements not given in context; never give a medical diagnosis; for any severe chest pain, breathing distress, fainting, or stroke signs tell the user to sit down and call emergency ${params.emergencyNumber}.`,
    vitalsSummary ? `Grounded patient context: ${vitalsSummary}.` : `No recent watch readings recorded yet.`,
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
    const res = await fetch(`${llmCfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${llmCfg.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: llmCfg.model,
        messages,
        temperature: 0.5,
        max_tokens: 220,
      }),
      signal: AbortSignal.timeout(7500),
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
