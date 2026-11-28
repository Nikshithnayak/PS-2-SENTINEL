import { env, pipeline } from '@huggingface/transformers';

// Fetch quantized ONNX weights from Hugging Face CDN and cache offline in browser CacheStorage
env.allowLocalModels = false;

type AsrPipeline = (
  audio: Float32Array,
  options?: Record<string, unknown>,
) => Promise<{ text?: string } | Array<{ text?: string }>>;

let recognizerPromise: Promise<AsrPipeline> | null = null;
// Multilingual base model (~77MB q8, cached in browser) dramatically cuts "Thank you." hallucinations
// on accented English, Hindi, and Kannada speech compared to whisper-tiny.
const MODEL_ID = 'Xenova/whisper-base';

function analyzeAndNormalizePcm(audio: Float32Array): {
  silent: boolean;
  pcm: Float32Array;
} {
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < audio.length; i += 1) {
    const sample = audio[i] ?? 0;
    const abs = Math.abs(sample);
    if (abs > peak) peak = abs;
    sumSq += sample * sample;
  }
  const rms = audio.length > 0 ? Math.sqrt(sumSq / audio.length) : 0;

  // Reject dead silence / fan hum before invoking Whisper so decoder cannot emit "Thank you."
  if (peak < 0.008 || rms < 0.0018) {
    return { silent: true, pcm: audio };
  }

  // Safely amplify quiet laptop microphone captures into optimal dynamic range
  if (peak < 0.35) {
    const gain = Math.min(10, 0.7 / peak);
    const boosted = new Float32Array(audio.length);
    for (let i = 0; i < audio.length; i += 1) {
      boosted[i] = Math.max(-0.96, Math.min(0.96, (audio[i] ?? 0) * gain));
    }
    return { silent: false, pcm: boosted };
  }

  return { silent: false, pcm: audio };
}

async function loadWhisper(): Promise<AsrPipeline> {
  if (!recognizerPromise) {
    recognizerPromise = pipeline('automatic-speech-recognition', MODEL_ID, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (info: { status?: string; progress?: number; file?: string }) => {
        if (info.status === 'progress' && typeof info.progress === 'number') {
          self.postMessage({
            type: 'progress',
            progress: Math.round(info.progress),
            file: info.file ?? 'model',
          });
        } else if (info.status === 'ready') {
          self.postMessage({ type: 'ready', model: MODEL_ID });
        }
      },
    }) as unknown as Promise<AsrPipeline>;
  }
  return recognizerPromise;
}

self.addEventListener('message', async (event: MessageEvent) => {
  const data = event.data as {
    id?: string;
    type?: string;
    audio?: Float32Array;
    locale?: 'en' | 'kn' | 'hi' | 'mixed';
  };

  if (data.type === 'preload') {
    try {
      await loadWhisper();
      self.postMessage({ type: 'ready', model: MODEL_ID });
    } catch (err) {
      self.postMessage({
        type: 'error',
        error: err instanceof Error ? err.message : 'Unable to initialize open-source Whisper',
      });
    }
    return;
  }

  if (data.type === 'transcribe' && data.audio instanceof Float32Array) {
    const reqId = data.id ?? 'default';
    try {
      const prepared = analyzeAndNormalizePcm(data.audio);
      if (prepared.silent) {
        self.postMessage({ type: 'transcript', id: reqId, text: '', filteredSilence: true });
        return;
      }

      const asr = await loadWhisper();
      const options: Record<string, unknown> = {
        task: 'transcribe',
        chunk_length_s: 20,
        stride_length_s: 4,
        no_repeat_ngram_size: 3,
      };
      if (data.locale && data.locale !== 'mixed') {
        options.language =
          data.locale === 'kn' ? 'kannada' : data.locale === 'hi' ? 'hindi' : 'english';
      }
      const output = await asr(prepared.pcm, options);
      const text = Array.isArray(output) ? (output[0]?.text ?? '') : (output?.text ?? '');
      self.postMessage({ type: 'transcript', id: reqId, text: text.trim() });
    } catch (err) {
      self.postMessage({
        type: 'error',
        id: reqId,
        error: err instanceof Error ? err.message : 'Whisper transcription failed',
      });
    }
  }
});
