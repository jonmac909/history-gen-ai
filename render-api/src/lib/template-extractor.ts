/**
 * Template Extractor - Extract editing styles from example videos
 * Analyzes video to learn text styles, transitions, pacing, etc.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { downloadVideo, extractFrames, detectScenes, analyzeColors } from './video-preprocessor';
import { analyzeFramesWithVision } from './opensource-vision-client';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { randomUUID } from 'crypto';

let supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Supabase credentials not configured');
    supabase = createClient(url, key);
  }
  return supabase;
}

export interface TemplateExtractionResult {
  templateId: string;
  textStyles: TextStyleAnalysis[];
  transitions: TransitionAnalysis;
  pacing: PacingAnalysis;
  brollPatterns: BRollAnalysis;
  colorPalette: string[];
}

export interface TextStyleAnalysis {
  id: string;
  name: string;
  font: string;
  size: number;
  color: string;
  position: string;
  animation: string;
  timing: { inDuration: number; holdDuration: number; outDuration: number };
  sampleText?: string;
}

export interface TransitionAnalysis {
  type: 'cut' | 'fade' | 'dissolve' | 'wipe';
  duration: number;
  frequency: number; // cuts per minute
}

export interface PacingAnalysis {
  avgSceneDuration: number;
  cutOnBeat: boolean;
  energyLevel: 'slow' | 'medium' | 'fast';
  totalScenes: number;
  totalDuration: number;
}

export interface BRollAnalysis {
  insertFrequency: number;
  duration: number;
  transitionIn: string;
  transitionOut: string;
}

/**
 * Extract editing template from an example video
 */
export async function extractTemplate(
  videoUrl: string,
  templateName: string,
  onProgress?: (progress: number, message: string) => void
): Promise<TemplateExtractionResult> {
  const tempDir = path.join(os.tmpdir(), `template-extract-${randomUUID()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    // Step 1: Download video (0-30%)
    onProgress?.(0, 'Downloading video...');
    const videoPath = path.join(tempDir, 'video.mp4');
    const { duration } = await downloadVideo(videoUrl, videoPath, '720p', (percent) => {
      onProgress?.(percent * 0.3, `Downloading video... ${percent.toFixed(0)}%`);
    });

    // Step 2: Extract frames for analysis (30-40%)
    onProgress?.(30, 'Extracting frames...');
    const framePaths = await extractFrames(videoPath, tempDir, 1); // 1 FPS
    onProgress?.(40, `Extracted ${framePaths.length} frames`);

    // Step 3: Scene detection (40-50%)
    onProgress?.(40, 'Detecting scenes and transitions...');
    const scenes = await detectScenes(videoPath);
    onProgress?.(50, `Detected ${scenes.length} scenes`);

    // Step 4: Analyze frames with LLaVA for text overlays (50-70%)
    onProgress?.(50, 'Analyzing text overlays and visual styles...');
    const frameAnalysis = await analyzeFramesForText(framePaths, (percent) => {
      onProgress?.(50 + percent * 0.2, 'Analyzing visual styles...');
    });
    onProgress?.(70, 'Text analysis complete');

    // Step 5: Color analysis (70-75%)
    onProgress?.(70, 'Analyzing color palette...');
    const colors = await analyzeColors(framePaths);
    const colorPalette = extractColorPalette(colors);
    onProgress?.(75, 'Color analysis complete');

    // Step 6: Calculate pacing metrics (75-85%)
    onProgress?.(75, 'Calculating pacing...');
    const pacing = calculatePacing(scenes, duration);
    const transitions = analyzeTransitions(scenes, duration);
    onProgress?.(85, 'Pacing analysis complete');

    // Step 7: Extract text styles from frame analysis (85-90%)
    onProgress?.(85, 'Extracting text styles...');
    const textStyles = extractTextStyles(frameAnalysis);
    onProgress?.(90, 'Text styles extracted');

    // Step 8: Estimate B-roll patterns (90-95%)
    onProgress?.(90, 'Analyzing B-roll patterns...');
    const brollPatterns = estimateBRollPatterns(scenes, duration);
    onProgress?.(95, 'B-roll analysis complete');

    // Step 9: Save to database (95-100%)
    onProgress?.(95, 'Saving template...');
    const templateId = await saveTemplate({
      name: templateName,
      source: videoUrl,
      textStyles,
      transitions,
      pacing,
      brollPatterns,
      colorPalette,
    });
    onProgress?.(100, 'Template saved!');

    return {
      templateId,
      textStyles,
      transitions,
      pacing,
      brollPatterns,
      colorPalette,
    };
  } finally {
    // Cleanup temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.error('Failed to cleanup temp directory:', error);
    }
  }
}

/**
 * Analyze frames for text overlays using LLaVA
 */
async function analyzeFramesForText(
  framePaths: string[],
  onProgress?: (percent: number) => void
): Promise<any[]> {
  // Sample frames (analyze every 10th frame to reduce cost)
  const sampledFrames = framePaths.filter((_, i) => i % 10 === 0);

  const prompt = `Analyze this video frame and describe any text overlays:
- Text content (what does it say?)
- Font style (serif, sans-serif, bold, etc.)
- Text size (small, medium, large)
- Text color
- Position on screen (top, bottom, center, corner)
- Background style (solid, transparent, semi-transparent)
- Animation hints (fading in, sliding, static)

If there is no text, say "No text overlay detected".`;

  const results = await analyzeFramesWithVision(
    sampledFrames,
    prompt,
    (progress) => onProgress?.(progress * 100)
  );

  return results;
}

/**
 * Calculate pacing metrics from scene detection
 */
function calculatePacing(scenes: any[], duration: number): PacingAnalysis {
  const totalScenes = scenes.length;
  const avgSceneDuration = duration / totalScenes;
  const cutsPerMinute = (totalScenes / duration) * 60;

  // Classify energy level based on cuts per minute
  let energyLevel: 'slow' | 'medium' | 'fast';
  if (cutsPerMinute < 3) energyLevel = 'slow';
  else if (cutsPerMinute < 5) energyLevel = 'medium';
  else energyLevel = 'fast';

  return {
    avgSceneDuration,
    cutOnBeat: false, // Would need audio analysis to detect
    energyLevel,
    totalScenes,
    totalDuration: duration,
  };
}

/**
 * Analyze transition patterns
 */
function analyzeTransitions(scenes: any[], duration: number): TransitionAnalysis {
  // For now, assume cuts (most common)
  // TODO: Detect fades by analyzing frame similarity at scene boundaries
  const cutsPerMinute = (scenes.length / duration) * 60;

  return {
    type: 'cut',
    duration: 0, // Cuts have no duration
    frequency: cutsPerMinute,
  };
}

/**
 * Extract text styles from LLaVA analysis results
 */
function extractTextStyles(frameAnalysis: any[]): TextStyleAnalysis[] {
  const textStyles: TextStyleAnalysis[] = [];

  // Filter frames that have text overlays
  const framesWithText = frameAnalysis.filter(
    (frame) => frame.description && !frame.description.toLowerCase().includes('no text')
  );

  if (framesWithText.length === 0) {
    // No text detected - return default style
    return [
      {
        id: '1',
        name: 'Default Text',
        font: 'Arial, sans-serif',
        size: 48,
        color: '#ffffff',
        position: 'center',
        animation: 'fadeIn',
        timing: { inDuration: 15, holdDuration: 60, outDuration: 15 },
      },
    ];
  }

  // TODO: Parse LLaVA descriptions to extract structured text style data
  // For now, create a generic style based on analysis
  textStyles.push({
    id: '1',
    name: 'Main Text',
    font: 'Arial, sans-serif', // Would parse from description
    size: 48,
    color: '#ffffff',
    position: 'center',
    animation: 'fadeIn',
    timing: { inDuration: 15, holdDuration: 60, outDuration: 15 },
    sampleText: framesWithText[0]?.description?.substring(0, 100),
  });

  return textStyles;
}

/**
 * Estimate B-roll patterns (this is heuristic-based)
 */
function estimateBRollPatterns(scenes: any[], duration: number): BRollAnalysis {
  // Default B-roll pattern estimates
  return {
    insertFrequency: 30, // Every 30 seconds
    duration: 5, // 5 second B-roll clips
    transitionIn: 'fade',
    transitionOut: 'fade',
  };
}

/**
 * Extract dominant color palette from color analysis
 */
function extractColorPalette(colors: any[]): string[] {
  if (colors.length === 0) return ['#000000'];

  // Collect all dominant colors
  const palette = new Set<string>();
  colors.forEach((color) => {
    if (color.dominantColor) palette.add(color.dominantColor);
    if (color.palette) color.palette.forEach((c: string) => palette.add(c));
  });

  return Array.from(palette).slice(0, 10); // Top 10 colors
}

/**
 * Save extracted template to Supabase
 */
async function saveTemplate(data: {
  name: string;
  source: string;
  textStyles: TextStyleAnalysis[];
  transitions: TransitionAnalysis;
  pacing: PacingAnalysis;
  brollPatterns: BRollAnalysis;
  colorPalette: string[];
}): Promise<string> {
  const supabase = getSupabase();

  const { data: template, error } = await supabase
    .from('editing_templates')
    .insert({
      name: data.name,
      source: data.source,
      description: `Auto-extracted from video. ${data.pacing.totalScenes} scenes, ${data.pacing.energyLevel} energy level`,
      text_styles: data.textStyles,
      transitions: data.transitions,
      pacing: data.pacing,
      broll_patterns: data.brollPatterns,
    })
    .select('id')
    .single();

  if (error) throw error;
  return template.id;
}
