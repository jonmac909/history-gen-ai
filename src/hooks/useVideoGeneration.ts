import { useState, useCallback, useRef } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

interface ImageTiming {
  imageUrl: string;
  duration: number;
}

interface VideoClip {
  index: number;
  videoUrl: string;
  videoBlob: Blob;
  duration: number;
}

interface VideoGenerationResult {
  success: boolean;
  clips?: VideoClip[];
  error?: string;
}

export function useVideoGeneration() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const loadedRef = useRef(false);

  const loadFFmpeg = useCallback(async () => {
    if (loadedRef.current && ffmpegRef.current) {
      return ffmpegRef.current;
    }

    const ffmpeg = new FFmpeg();
    ffmpegRef.current = ffmpeg;

    ffmpeg.on('progress', ({ progress: p }) => {
      // This is per-file progress, we'll handle overall progress separately
    });

    await ffmpeg.load({
      coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js',
      wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm',
    });

    loadedRef.current = true;
    return ffmpeg;
  }, []);

  // Parse SRT content to get total duration
  const parseSRT = useCallback((srtContent: string): { startTime: number; endTime: number }[] => {
    const segments: { startTime: number; endTime: number }[] = [];
    const blocks = srtContent.trim().split(/\n\n+/);

    for (const block of blocks) {
      const lines = block.trim().split('\n');
      if (lines.length >= 2) {
        const timeLine = lines[1];
        const timeMatch = timeLine.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
        
        if (timeMatch) {
          const startTime = 
            parseInt(timeMatch[1]) * 3600 + 
            parseInt(timeMatch[2]) * 60 + 
            parseInt(timeMatch[3]) + 
            parseInt(timeMatch[4]) / 1000;
          
          const endTime = 
            parseInt(timeMatch[5]) * 3600 + 
            parseInt(timeMatch[6]) * 60 + 
            parseInt(timeMatch[7]) + 
            parseInt(timeMatch[8]) / 1000;
          
          segments.push({ startTime, endTime });
        }
      }
    }

    return segments;
  }, []);

  // Calculate image timings based on SRT captions
  const calculateImageTimings = useCallback((
    imageUrls: string[], 
    srtContent: string
  ): ImageTiming[] => {
    const segments = parseSRT(srtContent);
    if (segments.length === 0) {
      // Fallback: 5 seconds per image
      return imageUrls.map((url) => ({
        imageUrl: url,
        duration: 5,
      }));
    }

    const totalDuration = segments[segments.length - 1].endTime;
    const imageDuration = totalDuration / imageUrls.length;

    return imageUrls.map((url) => ({
      imageUrl: url,
      duration: imageDuration,
    }));
  }, [parseSRT]);

  // Create video from single image using FFmpeg (correct duration)
  const createVideoFromImage = useCallback(async (
    ffmpeg: FFmpeg,
    imageUrl: string,
    duration: number,
    index: number
  ): Promise<Blob> => {
    // Fetch the image
    const imageData = await fetchFile(imageUrl);
    const inputName = `input_${index}.png`;
    const outputName = `output_${index}.mp4`;

    // Write input image to FFmpeg filesystem
    await ffmpeg.writeFile(inputName, imageData);

    // Create video with exact duration using loop and duration flags
    // -loop 1: loop the input image
    // -t: duration in seconds
    // -r 30: 30fps output
    // -pix_fmt yuv420p: compatible pixel format
    // -vf scale: ensure even dimensions for h264
    await ffmpeg.exec([
      '-loop', '1',
      '-i', inputName,
      '-c:v', 'libx264',
      '-t', duration.toFixed(2),
      '-pix_fmt', 'yuv420p',
      '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black',
      '-r', '30',
      '-preset', 'ultrafast',
      outputName
    ]);

    // Read the output video
    const data = await ffmpeg.readFile(outputName);
    const blob = new Blob([new Uint8Array(data as Uint8Array)], { type: 'video/mp4' });

    // Cleanup
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);

    return blob;
  }, []);

  const generateVideo = useCallback(async (
    imageUrls: string[],
    srtContent: string,
    _audioUrl?: string
  ): Promise<VideoGenerationResult> => {
    if (imageUrls.length === 0) {
      return { success: false, error: 'No images provided' };
    }

    setIsGenerating(true);
    setProgress(0);
    setStatus('Loading video encoder...');

    try {
      const ffmpeg = await loadFFmpeg();
      
      const timings = calculateImageTimings(imageUrls, srtContent);
      console.log('Image timings:', timings);

      const clips: VideoClip[] = [];
      const totalImages = imageUrls.length;

      for (let i = 0; i < totalImages; i++) {
        const timing = timings[i];
        const progressPercent = Math.round(((i + 0.5) / totalImages) * 100);
        
        setStatus(`Creating clip ${i + 1} of ${totalImages} (${timing.duration.toFixed(1)}s)...`);
        setProgress(progressPercent);

        console.log(`Creating clip ${i + 1} with duration ${timing.duration.toFixed(2)}s...`);

        const videoBlob = await createVideoFromImage(
          ffmpeg,
          timing.imageUrl,
          timing.duration,
          i
        );

        const videoUrl = URL.createObjectURL(videoBlob);

        clips.push({
          index: i,
          videoUrl,
          videoBlob,
          duration: timing.duration,
        });

        console.log(`Clip ${i + 1} created: ${(videoBlob.size / 1024).toFixed(1)}KB, duration: ${timing.duration.toFixed(2)}s`);
        
        setProgress(Math.round(((i + 1) / totalImages) * 100));
      }

      setProgress(100);
      setStatus('Complete!');
      setIsGenerating(false);

      return { success: true, clips };
    } catch (error) {
      console.error('Video generation error:', error);
      setIsGenerating(false);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to generate video' 
      };
    }
  }, [loadFFmpeg, calculateImageTimings, createVideoFromImage]);

  return {
    generateVideo,
    isGenerating,
    progress,
    status,
  };
}
