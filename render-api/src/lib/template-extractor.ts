/**
 * Template Extractor - Extract editing styles from example videos
 * Analyzes video to learn text styles, transitions, pacing, etc.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { downloadVideo, extractFrames, detectScenes } from './video-preprocessor';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { randomUUID } from 'crypto';
import sharp from 'sharp';

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
    const frameAnalysis = await analyzeFramesForText(framePaths, (percent: number) => {
      onProgress?.(50 + percent * 0.2, 'Analyzing visual styles...');
    });
    onProgress?.(70, 'Text analysis complete');

    // Step 5: Color analysis (70-75%)
    onProgress?.(70, 'Analyzing color palette...');
    const colorPalette = await extractColorPalette(framePaths);
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
 * Analyze frames for text overlays (simplified - no LLaVA for now)
 */
async function analyzeFramesForText(
  framePaths: string[],
  onProgress?: (percent: number) => void
): Promise<any[]> {
  // Sample frames (analyze every 10th frame to reduce cost)
  const sampledFrames = framePaths.filter((_, i) => i % 10 === 0);
  
  onProgress?.(100);
  
  // For now, return empty analysis
  // TODO: Integrate with LLaVA or other vision model
  return [];
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
 * Extract dominant color palette from frames
 */
async function extractColorPalette(framePaths: string[]): Promise<string[]> {
  if (framePaths.length === 0) return ['#000000'];

  try {
    // Sample a few frames for color analysis
    const samples = framePaths.filter((_, i) => i % 10 === 0).slice(0, 5);
    const palette = new Set<string>();

    for (const framePath of samples) {
      const { dominant } = await sharp(framePath)
        .stats();
      
      // Convert dominant color to hex
      const hex = `#${dominant.r.toString(16).padStart(2, '0')}${dominant.g.toString(16).padStart(2, '0')}${dominant.b.toString(16).padStart(2, '0')}`;
      palette.add(hex);
    }

    return Array.from(palette).slice(0, 10);
  } catch (error) {
    console.error('Color analysis failed:', error);
    return ['#000000'];
  }
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
