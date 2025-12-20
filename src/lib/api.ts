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

export interface AudioResult {
  success: boolean;
  audioUrl?: string;
  audioBase64?: string;
  duration?: number;
  size?: number;
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
  const { data, error } = await supabase.functions.invoke('get-youtube-transcript', {
    body: { url }
  });

  if (error) {
    console.error('Transcript error:', error);
    return { success: false, error: error.message };
  }

  return data;
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
  onProgress: (progress: number, wordCount: number) => void
): Promise<ScriptResult> {
  const CHUNK_SIZE = 30000; // Railway has no timeout limit - can generate full scripts in one call!

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
        }
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
  return generateSingleChunk(transcript, template, title, aiModel, wordCount, onProgress);
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
  onProgress: (progress: number, wordCount: number) => void
): Promise<ScriptResult> {
  // Use Railway API for script generation (no timeout limits!)
  const railwayUrl = import.meta.env.VITE_RAILWAY_API_URL;

  if (!railwayUrl) {
    return {
      success: false,
      error: 'Railway API URL not configured. Please set VITE_RAILWAY_API_URL in .env'
    };
  }

  // Add timeout and retry logic for long-running generations
  const controller = new AbortController();
  const timeoutMs = calculateDynamicTimeout(wordCount);
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Log timeout configuration for development debugging
  if (import.meta.env.DEV) {
    console.log('[Script Generation] Using Railway API (unlimited timeout):', {
      targetWordCount: wordCount,
      railwayUrl,
      overallTimeoutMs: timeoutMs,
      overallTimeoutMinutes: (timeoutMs / 60000).toFixed(1),
    });
  }

  try {
    const response = await fetch(`${railwayUrl}/rewrite-script`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transcript, template, title, model: aiModel, wordCount, stream: true }),
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

  const { data, error } = await supabase.functions.invoke('generate-audio', {
    body: { script, voiceSampleUrl, projectId }
  });

  if (error) {
    console.error('Audio generation error:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));

    // Provide more helpful error messages
    let errorMessage = error.message;
    if (errorMessage.includes('Voice sample not accessible')) {
      errorMessage = 'Cannot access your voice sample. Please try re-uploading it in Settings.';
    } else if (errorMessage.includes('TTS job failed')) {
      errorMessage = 'Voice cloning failed. This may be due to an issue with the voice sample or the TTS service. Try a different voice sample or contact support.';
    } else if (errorMessage.includes('timed out')) {
      errorMessage = 'Audio generation timed out. The script might be too long, or the service is experiencing delays. Try again in a moment.';
    }

    return { success: false, error: errorMessage };
  }

  if (data?.error) {
    console.error('Audio generation returned error:', data.error);
    return { success: false, error: data.error };
  }

  console.log('Audio generated successfully:', data);
  return data;
}

export async function generateAudioStreaming(
  script: string, 
  voiceSampleUrl: string, 
  projectId: string,
  onProgress: (progress: number) => void
): Promise<AudioResult> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  
  const response = await fetch(`${supabaseUrl}/functions/v1/generate-audio`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseKey}`,
      'apikey': supabaseKey,
    },
    body: JSON.stringify({ 
      script, 
      voiceSampleUrl, 
      projectId, 
      stream: true
    })
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

  try {
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
              onProgress(parsed.progress);
            } else if (parsed.type === 'complete') {
              result = {
                success: true,
                audioUrl: parsed.audioUrl,
                duration: parsed.duration,
                size: parsed.size
              };
              onProgress(100);
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
    return { 
      success: false, 
      error: streamError instanceof Error ? streamError.message : 'Stream reading failed' 
    };
  }

  return result;
}

export async function generateImagePrompts(
  script: string,
  srtContent: string,
  imageCount: number,
  stylePrompt: string
): Promise<ImagePromptsResult> {
  console.log('Generating AI-powered image prompts from script and captions...');

  const { data, error } = await supabase.functions.invoke('generate-image-prompts', {
    body: { script, srtContent, imageCount, stylePrompt }
  });

  if (error) {
    console.error('Image prompt generation error:', error);
    return { success: false, error: error.message };
  }

  return data;
}

export async function generateImages(
  prompts: string[] | ImagePromptWithTiming[],
  quality: string,
  aspectRatio: string = "16:9",
  projectId?: string
): Promise<ImageGenerationResult> {
  const { data, error } = await supabase.functions.invoke('generate-images', {
    body: { prompts, quality, aspectRatio, projectId }
  });

  if (error) {
    console.error('Image generation error:', error);
    return { success: false, error: error.message };
  }

  return data;
}

export async function generateImagesStreaming(
  prompts: string[] | ImagePromptWithTiming[],
  quality: string,
  aspectRatio: string = "16:9",
  onProgress: (completed: number, total: number, message: string) => void,
  projectId?: string
): Promise<ImageGenerationResult> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const response = await fetch(`${supabaseUrl}/functions/v1/generate-images`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseKey}`,
      'apikey': supabaseKey,
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

export async function generateCaptions(audioUrl: string, projectId: string): Promise<CaptionsResult> {
  const { data, error } = await supabase.functions.invoke('generate-captions', {
    body: { audioUrl, projectId }
  });

  if (error) {
    console.error('Captions error:', error);
    return { success: false, error: error.message };
  }

  return data;
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