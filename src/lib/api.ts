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
