import { env, pipeline } from '@huggingface/transformers';

// Fetch quantized ONNX weights from Hugging Face CDN and cache offline in browser CacheStorage
env.allowLocalModels = false;

type AsrPipeline = (
  audio: Float32Array,
  options?: Record<string, unknown>,
) => Promise<{ text?: string } | Array<{ text?: string }>>;

let recognizerPromise: Promise<AsrPipeline> | null = null;
const MODEL_ID = 'Xenova/whisper-tiny';

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
    locale?: 'en' | 'kn' | 'hi';
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
      const asr = await loadWhisper();
      const language =
        data.locale === 'kn' ? 'kannada' : data.locale === 'hi' ? 'hindi' : 'english';
      const output = await asr(data.audio, {
        language,
        task: 'transcribe',
        chunk_length_s: 20,
        stride_length_s: 4,
      });
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
