import { supabase } from "@/integrations/supabase/client";

/**
 * Calculate dynamic timeout based on target word count
 * Formula: min(1800000, (targetWords / 150) * 60000)
 * Assumes ~150 words/minute generation rate (conservative estimate)
 * Caps at 30 minutes max to support very long script generation
 *
 * @param targetWords - The target word count for script generation
 * @returns Timeout in milliseconds, capped at 1800000 (30 minutes)
 */
export function calculateDynamicTimeout(targetWords: number): number {
  // Ensure minimum timeout of 2 minutes for any request
  const MIN_TIMEOUT_MS = 120000;
  // Cap at 30 minutes to support very long script generation
  const MAX_TIMEOUT_MS = 1800000;

  // Estimate generation time: ~150 words per minute
  const estimatedMinutes = Math.ceil(targetWords / 150);
  const timeoutMs = estimatedMinutes * 60000;

  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, timeoutMs));
}

export interface TranscriptResult {
  success: boolean;
  videoId?: string;
  title?: string;
  transcript?: string | null;
  message?: string;
  error?: string;
}

export interface ScriptResult {
  success: boolean;
  script?: string;
  wordCount?: number;
  error?: string;
}

export interface AudioSegment {
  index: number;
  audioUrl: string;
  duration: number;
  size: number;
  text: string;
}

export interface AudioResult {
  success: boolean;
  audioUrl?: string;
  audioBase64?: string;
  duration?: number;
  size?: number;
  segments?: AudioSegment[];
  totalDuration?: number;
  error?: string;
}

export interface CaptionsResult {
  success: boolean;
  captionsUrl?: string;
  srtContent?: string;
  segmentCount?: number;
  estimatedDuration?: number;
  error?: string;
}

export interface ImageGenerationResult {
  success: boolean;
  images?: string[];
  error?: string;
}

export interface ImagePromptWithTiming {
  index: number;
  startTime: string;
  endTime: string;
  startSeconds: number;
  endSeconds: number;
  prompt: string;
  sceneDescription: string;
}

export interface ImagePromptsResult {
  success: boolean;
  prompts?: ImagePromptWithTiming[];
  totalDuration?: number;
  error?: string;
}

export interface GeneratedAssets {
  projectId: string;
  script: string;
  scriptUrl?: string;
  audioUrl?: string;
  captionsUrl?: string;
  audioDuration?: number;
}

export async function getYouTubeTranscript(url: string): Promise<TranscriptResult> {
  const renderUrl = import.meta.env.VITE_RENDER_API_URL;

  if (!renderUrl) {
    return {
      success: false,
      error: 'Render API URL not configured. Please set VITE_RENDER_API_URL in .env'
    };
  }

  try {
    const response = await fetch(`${renderUrl}/get-youtube-transcript`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Transcript error:', response.status, errorText);
      return { success: false, error: `Failed to fetch transcript: ${response.status}` };
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Transcript error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to fetch transcript' };
  }
}

export async function rewriteScript(transcript: string, template: string, title: string): Promise<ScriptResult> {
  const { data, error } = await supabase.functions.invoke('rewrite-script', {
    body: { transcript, template, title }
  });

  if (error) {
    console.error('Script error:', error);
    return { success: false, error: error.message };
  }

  return data;
}

export async function rewriteScriptStreaming(
  transcript: string,
  template: string,
  title: string,
  aiModel: string,
  wordCount: number,
  onProgress: (progress: number, wordCount: number) => void,
  onToken?: (token: string) => void, // Real-time token streaming callback
  fastMode?: boolean // Use faster Haiku model instead of Sonnet
): Promise<ScriptResult> {
  const CHUNK_SIZE = 30000; // Render has no timeout limit - can generate full scripts in one call!

  // For large scripts, split into chunks to avoid Supabase 5-minute timeout
  if (wordCount > CHUNK_SIZE) {
    if (import.meta.env.DEV) {
      console.log(`[Script Generation] Chunking ${wordCount} words into ${Math.ceil(wordCount / CHUNK_SIZE)} chunks of ${CHUNK_SIZE} words`);
    }

    const numChunks = Math.ceil(wordCount / CHUNK_SIZE);
    let fullScript = '';
    let totalWordsGenerated = 0;

    for (let i = 0; i < numChunks; i++) {
      const chunkWordCount = Math.min(CHUNK_SIZE, wordCount - totalWordsGenerated);
      const chunkStartProgress = (i / numChunks) * 100;
      const chunkEndProgress = ((i + 1) / numChunks) * 100;

      if (import.meta.env.DEV) {
        console.log(`[Script Generation] Generating chunk ${i + 1}/${numChunks}: ${chunkWordCount} words (${chunkStartProgress.toFixed(0)}% - ${chunkEndProgress.toFixed(0)}%)`);
      }

      // Modify template for continuation chunks
      let chunkTemplate = template;
      if (fullScript) {
        chunkTemplate = `${template}

CRITICAL: You are continuing an existing script. Here is what has been written so far:

${fullScript}

Continue the narrative seamlessly from where this left off. DO NOT repeat any content. DO NOT add headers, titles, or scene markers. Write as if this is a natural continuation of the existing script.`;
      }

      // Generate this chunk with progress mapping
      const chunkResult = await generateSingleChunk(
        transcript,
        chunkTemplate,
        title,
        aiModel,
        chunkWordCount,
        (chunkProgress, chunkWords) => {
          // Map chunk progress to overall progress
          const overallProgress = chunkStartProgress + (chunkProgress / 100) * (chunkEndProgress - chunkStartProgress);
          const overallWords = totalWordsGenerated + chunkWords;
          onProgress(Math.round(overallProgress), overallWords);
        },
        onToken // Pass through token callback
      );

      if (!chunkResult.success) {
        // If chunk failed but we have partial script, return what we have
        if (fullScript && totalWordsGenerated > 500) {
          return {
            success: true,
            script: fullScript,
            wordCount: totalWordsGenerated
          };
        }
        return chunkResult;
      }

      fullScript += (fullScript ? '\n\n' : '') + chunkResult.script;
      totalWordsGenerated += chunkResult.wordCount || 0;

      if (import.meta.env.DEV) {
        console.log(`[Script Generation] Chunk ${i + 1}/${numChunks} complete: ${chunkResult.wordCount} words generated (total: ${totalWordsGenerated})`);
      }
    }

    return {
      success: true,
      script: fullScript,
      wordCount: totalWordsGenerated
    };
  }

  // For scripts <= 5000 words, use single-chunk generation
  return generateSingleChunk(transcript, template, title, aiModel, wordCount, onProgress, onToken);
}

/**
 * Internal function to generate a single chunk of script
 * Handles the actual API call and streaming logic
 */
async function generateSingleChunk(
  transcript: string,
  template: string,
  title: string,
  aiModel: string,
  wordCount: number,
  onProgress: (progress: number, wordCount: number) => void,
  onToken?: (token: string) => void // NEW: Real-time token streaming
): Promise<ScriptResult> {
  // Use Render API for script generation (no timeout limits!)
  const renderUrl = import.meta.env.VITE_RENDER_API_URL;

  if (!renderUrl) {
    return {
      success: false,
      error: 'Render API URL not configured. Please set VITE_RENDER_API_URL in .env'
    };
  }

  // Add timeout and retry logic for long-running generations
  const controller = new AbortController();
  const timeoutMs = calculateDynamicTimeout(wordCount);
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Log timeout configuration for development debugging
  if (import.meta.env.DEV) {
    console.log('[Script Generation] Using Render API (unlimited timeout):', {
      targetWordCount: wordCount,
      renderUrl,
      overallTimeoutMs: timeoutMs,
      overallTimeoutMinutes: (timeoutMs / 60000).toFixed(1),
    });
  }

  try {
    const response = await fetch(`${renderUrl}/rewrite-script`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transcript, template, title, model: aiModel, wordCount, stream: true, fastMode }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Script streaming error:', response.status, errorText);
      return { success: false, error: `Failed to rewrite script: ${response.status}` };
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return { success: false, error: 'No response body' };
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let result: ScriptResult = { success: false, error: 'No response received from AI' };
    let lastWordCount = 0;
    let lastScript = '';
    let lastEventTime = Date.now();
    const eventTimeout = 600000; // 10 minute timeout between events (for very long API calls)

    try {
      while (true) {
        // Check if we've been waiting too long for an event
        if (Date.now() - lastEventTime > eventTimeout) {
          if (import.meta.env.DEV) {
            console.warn('[Script Generation] Event timeout triggered - no data received for 10 minutes', {
              lastEventTime: new Date(lastEventTime).toISOString(),
              elapsedMs: Date.now() - lastEventTime,
              lastWordCount,
            });
          } else {
            console.warn('Event timeout - no data received for 10 minutes');
          }
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;
        
        lastEventTime = Date.now();
        buffer += decoder.decode(value, { stream: true });
        
        // Process complete SSE events
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const event of events) {
          if (!event.trim()) continue;
          
          const dataMatch = event.match(/^data: (.+)$/m);
          if (dataMatch) {
            try {
              const parsed = JSON.parse(dataMatch[1]);
              
              if (parsed.type === 'progress') {
                lastWordCount = parsed.wordCount;
                onProgress(parsed.progress, parsed.wordCount);
              } else if (parsed.type === 'token') {
                // NEW: Stream tokens in real-time for better UX
                if (onToken && parsed.text) {
                  onToken(parsed.text);
                }
              } else if (parsed.type === 'complete') {
                lastScript = parsed.script;
                lastWordCount = parsed.wordCount;
                result = {
                  success: parsed.success,
                  script: parsed.script,
                  wordCount: parsed.wordCount
                };
                onProgress(100, parsed.wordCount);
              } else if (parsed.type === 'error' || parsed.error) {
                result = {
                  success: false,
                  error: parsed.error || parsed.message || 'AI generation failed'
                };
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }
    } catch (streamError) {
      console.error('Stream reading error:', streamError);
      
      // If we have partial content, return it
      if (lastScript && lastWordCount > 500) {
        console.log(`Returning partial script with ${lastWordCount} words after stream error`);
        return {
          success: true,
          script: lastScript,
          wordCount: lastWordCount
        };
      }
      
      // Check if it's an abort error
      if (streamError instanceof Error && streamError.name === 'AbortError') {
        if (import.meta.env.DEV) {
          console.error('[Script Generation] Request aborted due to timeout', {
            targetWordCount: wordCount,
            timeoutMs,
            lastWordCount,
            hasPartialScript: !!lastScript,
          });
        }
        return {
          success: false,
          error: 'Request timed out. Scripts up to 30,000 words are supported (up to 30 minutes generation time). For very long content, ensure stable internet connection.'
        };
      }
      
      return { 
        success: false, 
        error: streamError instanceof Error ? streamError.message : 'Stream reading failed' 
      };
    }

    // If we got progress but no complete event, something went wrong
    if (!result.success && lastWordCount > 0) {
      // If we have a partial script, return it as success
      if (lastScript && lastWordCount > 500) {
        if (import.meta.env.DEV) {
          console.log('[Script Generation] Returning partial script after incomplete stream', {
            wordCount: lastWordCount,
            scriptLength: lastScript.length,
          });
        }
        return {
          success: true,
          script: lastScript,
          wordCount: lastWordCount
        };
      }
      result.error = 'Script generation was interrupted before completing. The connection may have been lost. Please try again.';
    }

    // Log successful completion in development mode
    if (import.meta.env.DEV && result.success) {
      console.log('[Script Generation] Stream completed successfully', {
        targetWordCount: wordCount,
        actualWordCount: result.wordCount,
        scriptLength: result.script?.length,
      });
    }

    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function generateAudio(script: string, voiceSampleUrl: string, projectId: string): Promise<AudioResult> {
  console.log('Generating audio with voice cloning...');
  console.log('Voice sample URL:', voiceSampleUrl);
  console.log('Script length:', script.length, 'chars');

  const renderUrl = import.meta.env.VITE_RENDER_API_URL;

  if (!renderUrl) {
    return {
      success: false,
      error: 'Render API URL not configured. Please set VITE_RENDER_API_URL in .env'
    };
  }

  try {
    const response = await fetch(`${renderUrl}/generate-audio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ script, voiceSampleUrl, projectId })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Audio generation error:', response.status, errorText);
      return { success: false, error: `Failed to generate audio: ${response.status}` };
    }

    const data = await response.json();

    if (data?.error) {
      console.error('Audio generation returned error:', data.error);

      // Provide more helpful error messages
      let errorMessage = data.error;
      if (errorMessage.includes('Voice sample not accessible')) {
        errorMessage = 'Cannot access your voice sample. Please try re-uploading it in Settings.';
      } else if (errorMessage.includes('TTS job failed')) {
        errorMessage = 'Voice cloning failed. This may be due to an issue with the voice sample or the TTS service. Try a different voice sample or contact support.';
      } else if (errorMessage.includes('timed out')) {
        errorMessage = 'Audio generation timed out. The script might be too long, or the service is experiencing delays. Try again in a moment.';
      }

      return { success: false, error: errorMessage };
    }

    console.log('Audio generated successfully:', data);
    return data;
  } catch (error) {
    console.error('Audio generation error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to generate audio' };
  }
}

export async function generateAudioStreaming(
  script: string,
  voiceSampleUrl: string,
  projectId: string,
  onProgress: (progress: number, message?: string) => void,
  speed: number = 1.0
): Promise<AudioResult> {
  const renderUrl = import.meta.env.VITE_RENDER_API_URL;

  if (!renderUrl) {
    return {
      success: false,
      error: 'Render API URL not configured. Please set VITE_RENDER_API_URL in .env'
    };
  }

  // Add timeout for very large audio generations with voice cloning (60 minutes max)
  const controller = new AbortController();
  const AUDIO_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes (voice cloning takes longer)
  const timeoutId = setTimeout(() => controller.abort(), AUDIO_TIMEOUT_MS);

  try {
    const response = await fetch(`${renderUrl}/generate-audio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        script,
        voiceSampleUrl,
        projectId,
        speed,
        stream: true
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Audio streaming error:', response.status, errorText);
      return { success: false, error: `Failed to generate audio: ${response.status}` };
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return { success: false, error: 'No response body' };
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let result: AudioResult = { success: false, error: 'No response received' };
    let lastEventTime = Date.now();
    const EVENT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes between events (voice cloning takes longer)

    try {
      while (true) {
        // Check if we've been waiting too long for an event
        if (Date.now() - lastEventTime > EVENT_TIMEOUT_MS) {
          console.error('[Audio Generation] Event timeout - no data received for 10 minutes');
          result.error = 'Audio generation timed out - no progress received for 10 minutes. Please try again.';
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        lastEventTime = Date.now(); // Reset timeout on each chunk
        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const event of events) {
          if (!event.trim()) continue;

          // Skip keepalive comments
          if (event.startsWith(':')) continue;

          const dataMatch = event.match(/^data: (.+)$/m);
          if (dataMatch) {
            try {
              const parsed = JSON.parse(dataMatch[1]);

              if (parsed.type === 'progress') {
                onProgress(parsed.progress, parsed.message);
              } else if (parsed.type === 'complete') {
                // Parse segments if present
                const segments = parsed.segments && Array.isArray(parsed.segments)
                  ? parsed.segments as AudioSegment[]
                  : undefined;

                result = {
                  success: true,
                  // Prefer combined audioUrl, fallback to first segment URL
                  audioUrl: parsed.audioUrl || segments?.[0]?.audioUrl,
                  duration: parsed.duration ?? parsed.totalDuration ?? (segments?.reduce((sum, seg) => sum + seg.duration, 0)),
                  size: parsed.size ?? (segments?.reduce((sum, seg) => sum + seg.size, 0)),
                  segments: segments,
                  totalDuration: parsed.totalDuration,
                };
                onProgress(100, 'Complete!');
              } else if (parsed.type === 'error' || parsed.error) {
                result = {
                  success: false,
                  error: parsed.error || 'Audio generation failed'
                };
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }
    } catch (streamError) {
      console.error('Stream reading error:', streamError);

      // Check if it's an abort error from timeout
      if (streamError instanceof Error && streamError.name === 'AbortError') {
        return {
          success: false,
          error: 'Audio generation timed out after 60 minutes. This may happen with very long scripts or large voice samples. Please try again with a shorter script or smaller voice sample.'
        };
      }

      return {
        success: false,
        error: streamError instanceof Error ? streamError.message : 'Stream reading failed'
      };
    } finally {
      // Always clear the timeout to prevent memory leaks
      clearTimeout(timeoutId);
    }

    return result;
  } catch (error) {
    // Outer catch for fetch errors
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        error: 'Audio generation timed out after 60 minutes. This may happen with very long scripts. Please try again or contact support.'
      };
    }

    console.error('Audio generation fetch error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start audio generation'
    };
  }
}

// Regenerate a single audio segment
export async function regenerateAudioSegment(
  segmentText: string,
  segmentIndex: number,
  voiceSampleUrl: string,
  projectId: string
): Promise<{ success: boolean; segment?: AudioSegment; error?: string }> {
  const renderApiUrl = import.meta.env.VITE_RENDER_API_URL || 'https://history-gen-ai-production-f1d4.up.railway.app';

  try {
    const response = await fetch(`${renderApiUrl}/generate-audio/segment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        segmentText,
        segmentIndex,
        voiceSampleUrl,
        projectId
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Segment regeneration error:', response.status, errorText);
      return { success: false, error: `Failed to regenerate segment: ${response.status}` };
    }

    const data = await response.json();

    if (data.error) {
      return { success: false, error: data.error };
    }

    return {
      success: true,
      segment: data.segment
    };
  } catch (error) {
    console.error('Segment regeneration error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Segment regeneration failed'
    };
  }
}

export async function generateImagePrompts(
  script: string,
  srtContent: string,
  imageCount: number,
  stylePrompt: string,
  audioDuration?: number,
  onProgress?: (progress: number, message: string) => void
): Promise<ImagePromptsResult> {
  console.log('Generating AI-powered image prompts from script and captions...');
  console.log(`Script length: ${script.length}, SRT length: ${srtContent.length}, imageCount: ${imageCount}`);
  if (audioDuration) {
    console.log(`Audio duration: ${audioDuration.toFixed(2)}s - images will be evenly distributed across full audio`);
  }

  const renderUrl = import.meta.env.VITE_RENDER_API_URL;

  // Use Railway API with streaming for progress
  if (renderUrl && onProgress) {
    try {
      const response = await fetch(`${renderUrl}/generate-image-prompts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script, srtContent, imageCount, stylePrompt, audioDuration, stream: true })
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let result: ImagePromptsResult = { success: false, error: 'No response received' };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'progress') {
                onProgress(data.progress, data.message || `${data.progress}%`);
              } else if (data.type === 'complete') {
                result = {
                  success: true,
                  prompts: data.prompts,
                  totalDuration: data.totalDuration
                };
              } else if (data.type === 'error') {
                result = { success: false, error: data.error };
              }
            } catch (e) {
              // Ignore parse errors for keepalive comments
            }
          }
        }
      }

      return result;
    } catch (error) {
      console.error('Streaming image prompts error:', error);
      // Fall back to Supabase function
    }
  }

  // Fallback to Supabase Edge Function (no streaming)
  const { data, error } = await supabase.functions.invoke('generate-image-prompts', {
    body: { script, srtContent, imageCount, stylePrompt, audioDuration }
  });

  if (error) {
    console.error('Image prompt generation error:', error);
    const errorMessage = error.message || 'Unknown error';
    console.error('Error details:', JSON.stringify(error, null, 2));
    return { success: false, error: errorMessage };
  }

  if (!data) {
    return { success: false, error: 'No data returned from image prompt generation' };
  }

  return data;
}

export async function generateImages(
  prompts: string[] | ImagePromptWithTiming[],
  quality: string,
  aspectRatio: string = "16:9",
  projectId?: string
): Promise<ImageGenerationResult> {
  const renderUrl = import.meta.env.VITE_RENDER_API_URL;

  if (!renderUrl) {
    return {
      success: false,
      error: 'Render API URL not configured. Please set VITE_RENDER_API_URL in .env'
    };
  }

  try {
    const response = await fetch(`${renderUrl}/generate-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompts, quality, aspectRatio, projectId })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Image generation error:', response.status, errorText);
      return { success: false, error: `Failed to generate images: ${response.status}` };
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Image generation error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to generate images' };
  }
}

export async function generateImagesStreaming(
  prompts: string[] | ImagePromptWithTiming[],
  quality: string,
  aspectRatio: string = "16:9",
  onProgress: (completed: number, total: number, message: string) => void,
  projectId?: string
): Promise<ImageGenerationResult> {
  const renderUrl = import.meta.env.VITE_RENDER_API_URL;

  if (!renderUrl) {
    return {
      success: false,
      error: 'Render API URL not configured. Please set VITE_RENDER_API_URL in .env'
    };
  }

  const response = await fetch(`${renderUrl}/generate-images`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompts, quality, aspectRatio, stream: true, projectId })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Image streaming error:', response.status, errorText);
    return { success: false, error: `Failed to generate images: ${response.status}` };
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return { success: false, error: 'No response body' };
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let result: ImageGenerationResult = { success: false, error: 'No response received' };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const event of events) {
        if (!event.trim()) continue;
        
        const dataMatch = event.match(/^data: (.+)$/m);
        if (dataMatch) {
          try {
            const parsed = JSON.parse(dataMatch[1]);
            
            if (parsed.type === 'progress') {
              onProgress(parsed.completed, parsed.total, parsed.message);
            } else if (parsed.type === 'complete') {
              result = {
                success: parsed.success,
                images: parsed.images
              };
              onProgress(parsed.total, parsed.total, `${parsed.total}/${parsed.total} done`);
            } else if (parsed.type === 'error' || parsed.error) {
              result = {
                success: false,
                error: parsed.error || 'Image generation failed'
              };
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }
  } catch (streamError) {
    console.error('Stream reading error:', streamError);
    return { 
      success: false, 
      error: streamError instanceof Error ? streamError.message : 'Stream reading failed' 
    };
  }

  return result;
}

export async function generateCaptions(
  audioUrl: string,
  projectId: string,
  onProgress?: (progress: number, message?: string) => void
): Promise<CaptionsResult> {
  const renderUrl = import.meta.env.VITE_RENDER_API_URL;

  if (!renderUrl) {
    return {
      success: false,
      error: 'Render API URL not configured. Please set VITE_RENDER_API_URL in .env'
    };
  }

  // Use streaming if onProgress callback is provided
  if (onProgress) {
    return generateCaptionsStreaming(audioUrl, projectId, onProgress);
  }

  try {
    const response = await fetch(`${renderUrl}/generate-captions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ audioUrl, projectId })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Captions error:', response.status, errorText);
      return { success: false, error: `Failed to generate captions: ${response.status}` };
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Captions error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to generate captions' };
  }
}

async function generateCaptionsStreaming(
  audioUrl: string,
  projectId: string,
  onProgress: (progress: number, message?: string) => void
): Promise<CaptionsResult> {
  const renderUrl = import.meta.env.VITE_RENDER_API_URL;

  try {
    const response = await fetch(`${renderUrl}/generate-captions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audioUrl,
        projectId,
        stream: true
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Captions streaming error:', response.status, errorText);
      return { success: false, error: `Failed to generate captions: ${response.status}` };
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return { success: false, error: 'No response body' };
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let result: CaptionsResult = { success: false, error: 'No response received' };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE events
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const event of events) {
        if (!event.trim()) continue;

        const dataMatch = event.match(/^data: (.+)$/m);
        if (dataMatch) {
          try {
            const parsed = JSON.parse(dataMatch[1]);

            if (parsed.type === 'progress') {
              onProgress(parsed.progress, parsed.message);
            } else if (parsed.type === 'complete') {
              result = {
                success: true,
                captionsUrl: parsed.captionsUrl,
                srtContent: parsed.srtContent,
                segmentCount: parsed.segmentCount,
                audioDuration: parsed.audioDuration
              };
              onProgress(100);
            } else if (parsed.type === 'error' || parsed.error) {
              result = {
                success: false,
                error: parsed.error || 'Caption generation failed'
              };
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }

    return result;
  } catch (error) {
    console.error('Captions streaming error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to generate captions' };
  }
}

export interface VideoResult {
  success: boolean;
  error?: string;
  edlUrl?: string;
  edlContent?: string;
  csvUrl?: string;
  csvContent?: string;
  totalDuration?: number;
  totalDurationFormatted?: string;
  segments?: {
    imageUrl: string;
    index: number;
    startTime: number;
    endTime: number;
    duration: number;
    startTimeFormatted: string;
    endTimeFormatted: string;
    durationFormatted: string;
  }[];
}

export async function generateVideoTimeline(imageUrls: string[], srtContent: string, projectId: string): Promise<VideoResult> {
  const { data, error } = await supabase.functions.invoke('generate-video', {
    body: { imageUrls, srtContent, projectId }
  });

  if (error) {
    console.error('Video timeline error:', error);
    return { success: false, error: error.message };
  }

  return data;
}

export async function saveScriptToStorage(script: string, projectId: string): Promise<string | null> {
  const fileName = `${projectId}/script.md`;
  
  const { data, error } = await supabase.storage
    .from('generated-assets')
    .upload(fileName, new Blob([script], { type: 'text/markdown' }), {
      contentType: 'text/markdown',
      upsert: true
    });

  if (error) {
    console.error('Script upload error:', error);
    return null;
  }

  const { data: urlData } = supabase.storage
    .from('generated-assets')
    .getPublicUrl(fileName);

  return urlData.publicUrl;
}

export function downloadFile(url: string, filename: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.target = '_blank';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function downloadText(content: string, filename: string, mimeType: string = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  downloadFile(url, filename);
  URL.revokeObjectURL(url);
}

export interface RenderVideoResult {
  success: boolean;
  videoUrl?: string;
  videoUrlCaptioned?: string;
  size?: number;
  sizeCaptioned?: number;
  error?: string;
}

export interface RenderVideoProgress {
  stage: 'downloading' | 'preparing' | 'rendering' | 'uploading';
  percent: number;
  message: string;
  frames?: number;
}

export interface RenderVideoCallbacks {
  onProgress: (progress: RenderVideoProgress) => void;
  onVideoReady?: (videoUrl: string) => void;
  onCaptionError?: (error: string) => void;
}

export async function renderVideoStreaming(
  projectId: string,
  audioUrl: string,
  imageUrls: string[],
  imageTimings: { startSeconds: number; endSeconds: number }[],
  srtContent: string,
  projectTitle: string,
  callbacks: RenderVideoCallbacks | ((progress: RenderVideoProgress) => void)
): Promise<RenderVideoResult> {
  // Support both old callback style and new object style
  const { onProgress, onVideoReady, onCaptionError } = typeof callbacks === 'function'
    ? { onProgress: callbacks, onVideoReady: undefined, onCaptionError: undefined }
    : callbacks;
  const renderUrl = import.meta.env.VITE_RENDER_API_URL;

  if (!renderUrl) {
    return {
      success: false,
      error: 'Render API URL not configured. Please set VITE_RENDER_API_URL in .env'
    };
  }

  // Long timeout for video rendering (30 minutes)
  const controller = new AbortController();
  const RENDER_TIMEOUT_MS = 30 * 60 * 1000;
  const timeoutId = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS);

  try {
    const response = await fetch(`${renderUrl}/render-video`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectId,
        audioUrl,
        imageUrls,
        imageTimings,
        srtContent,
        projectTitle
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Render video error:', response.status, errorText);
      return { success: false, error: `Failed to render video: ${response.status}` };
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return { success: false, error: 'No response body' };
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let result: RenderVideoResult = { success: false, error: 'No response received' };
    let lastEventTime = Date.now();
    const EVENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes between events (rendering can be slow)

    try {
      while (true) {
        // Check if we've been waiting too long for an event
        if (Date.now() - lastEventTime > EVENT_TIMEOUT_MS) {
          console.error('[Render Video] Event timeout - no data received for 5 minutes');
          result.error = 'Video rendering timed out - no progress received for 5 minutes. Please try again.';
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        lastEventTime = Date.now();
        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const event of events) {
          if (!event.trim()) continue;

          // Skip keepalive comments
          if (event.startsWith(':')) continue;

          const dataMatch = event.match(/^data: (.+)$/m);
          if (dataMatch) {
            try {
              const parsed = JSON.parse(dataMatch[1]);

              if (parsed.type === 'progress') {
                onProgress({
                  stage: parsed.stage,
                  percent: parsed.percent,
                  message: parsed.message,
                  frames: parsed.frames
                });
              } else if (parsed.type === 'video_ready') {
                // Video without captions is ready - store it in case captioning fails
                result = {
                  success: true,
                  videoUrl: parsed.videoUrl,
                  size: parsed.size
                };
                // Notify caller that video is ready for preview/download
                if (onVideoReady) {
                  onVideoReady(parsed.videoUrl);
                }
                onProgress({
                  stage: 'rendering',
                  percent: parsed.percent || 82,
                  message: parsed.message || 'Video ready! Now burning captions...'
                });
              } else if (parsed.type === 'caption_error') {
                // Captions failed but we have the video without captions
                console.warn('Caption burning failed:', parsed.error);
                if (onCaptionError) {
                  onCaptionError(parsed.error || 'Caption burning failed');
                }
                // Keep the existing result (video without captions)
              } else if (parsed.type === 'complete') {
                result = {
                  success: true,
                  videoUrl: parsed.videoUrl,
                  videoUrlCaptioned: parsed.videoUrlCaptioned,
                  size: parsed.size,
                  sizeCaptioned: parsed.sizeCaptioned
                };
                onProgress({
                  stage: 'uploading',
                  percent: 100,
                  message: 'Complete!'
                });
              } else if (parsed.type === 'error' || parsed.error) {
                result = {
                  success: false,
                  error: parsed.error || 'Video rendering failed'
                };
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }
    } catch (streamError) {
      console.error('Stream reading error:', streamError);

      if (streamError instanceof Error && streamError.name === 'AbortError') {
        return {
          success: false,
          error: 'Video rendering timed out after 30 minutes. Please try again.'
        };
      }

      return {
        success: false,
        error: streamError instanceof Error ? streamError.message : 'Stream reading failed'
      };
    } finally {
      clearTimeout(timeoutId);
    }

    return result;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        error: 'Video rendering timed out after 30 minutes. Please try again.'
      };
    }

    console.error('Render video fetch error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start video rendering'
    };
  }
}