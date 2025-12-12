import { supabase } from "@/integrations/supabase/client";

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
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  
  // Add timeout and retry logic for long-running generations
  const controller = new AbortController();
  const timeoutMs = 300000; // 5 minute timeout for entire operation
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/rewrite-script`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`,
        'apikey': supabaseKey,
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
    const eventTimeout = 120000; // 2 minute timeout between events

    try {
      while (true) {
        // Check if we've been waiting too long for an event
        if (Date.now() - lastEventTime > eventTimeout) {
          console.warn('Event timeout - no data received for 2 minutes');
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
        return { 
          success: false, 
          error: 'Request timed out. For very long scripts (15k+ words), try generating in smaller batches.' 
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
        return {
          success: true,
          script: lastScript,
          wordCount: lastWordCount
        };
      }
      result.error = 'Script generation was interrupted. The connection may have timed out. Try a shorter word count (e.g., 5000-10000 words).';
    }

    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function generateAudio(script: string, voiceId: string, projectId: string): Promise<AudioResult> {
  const { data, error } = await supabase.functions.invoke('generate-audio', {
    body: { script, voiceId, projectId }
  });

  if (error) {
    console.error('Audio error:', error);
    return { success: false, error: error.message };
  }

  return data;
}

export async function generateAudioStreaming(
  script: string, 
  voiceId: string, 
  projectId: string,
  onProgress: (progress: number, currentChunk: number, totalChunks: number) => void
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
    body: JSON.stringify({ script, voiceId, projectId, stream: true })
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
              onProgress(parsed.progress, parsed.currentChunk, parsed.totalChunks);
            } else if (parsed.type === 'complete') {
              result = {
                success: true,
                audioUrl: parsed.audioUrl,
                duration: parsed.duration,
                size: parsed.size
              };
              onProgress(100, parsed.totalChunks, parsed.totalChunks);
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

export async function generateImages(
  prompts: string[], 
  quality: string, 
  aspectRatio: string = "16:9"
): Promise<ImageGenerationResult> {
  const { data, error } = await supabase.functions.invoke('generate-images', {
    body: { prompts, quality, aspectRatio }
  });

  if (error) {
    console.error('Image generation error:', error);
    return { success: false, error: error.message };
  }

  return data;
}

export async function generateImagesStreaming(
  prompts: string[], 
  quality: string, 
  aspectRatio: string = "16:9",
  onProgress: (completed: number, total: number, message: string) => void
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
    body: JSON.stringify({ prompts, quality, aspectRatio, stream: true })
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

export async function generateCaptions(script: string, audioDuration: number, projectId: string): Promise<CaptionsResult> {
  const { data, error } = await supabase.functions.invoke('generate-captions', {
    body: { script, audioDuration, projectId }
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