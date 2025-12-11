import { useState, useRef, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

interface ImageTiming {
  imageUrl: string;
  startTime: number;
  endTime: number;
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

    ffmpeg.on('log', ({ message }) => {
      console.log('[FFmpeg]', message);
    });

    setStatus('Downloading FFmpeg...');
    setProgress(5);
    
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
    
    try {
      console.log('[FFmpeg] Fetching core JS...');
      const coreResponse = await fetch(`${baseURL}/ffmpeg-core.js`);
      const coreBlob = new Blob([await coreResponse.text()], { type: 'text/javascript' });
      const coreURL = URL.createObjectURL(coreBlob);
      setProgress(10);
      
      setStatus('Downloading FFmpeg WASM...');
      console.log('[FFmpeg] Fetching WASM...');
      const wasmResponse = await fetch(`${baseURL}/ffmpeg-core.wasm`);
      const wasmBlob = new Blob([await wasmResponse.arrayBuffer()], { type: 'application/wasm' });
      const wasmURL = URL.createObjectURL(wasmBlob);
      setProgress(20);
      
      setStatus('Initializing FFmpeg...');
      console.log('[FFmpeg] Loading...');
      await ffmpeg.load({ coreURL, wasmURL });
      setProgress(25);
      
      console.log('[FFmpeg] Loaded successfully!');
    } catch (e) {
      console.error('FFmpeg load failed:', e);
      throw new Error('Failed to load FFmpeg: ' + (e instanceof Error ? e.message : 'Unknown error'));
    }

    loadedRef.current = true;
    return ffmpeg;
  }, []);

  // Parse SRT content to get timings
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
      return imageUrls.map((url, i) => ({
        imageUrl: url,
        startTime: i * 5,
        endTime: (i + 1) * 5,
        duration: 5,
      }));
    }

    const totalDuration = segments[segments.length - 1].endTime;
    const imageDuration = totalDuration / imageUrls.length;

    return imageUrls.map((url, i) => ({
      imageUrl: url,
      startTime: i * imageDuration,
      endTime: (i + 1) * imageDuration,
      duration: imageDuration,
    }));
  }, [parseSRT]);

  const generateVideo = useCallback(async (
    imageUrls: string[],
    srtContent: string,
    _audioUrl?: string // Not used for individual clips
  ): Promise<VideoGenerationResult> => {
    if (imageUrls.length === 0) {
      return { success: false, error: 'No images provided' };
    }

    setIsGenerating(true);
    setProgress(0);

    try {
      const ffmpeg = await loadFFmpeg();
      
      // Calculate timings
      const timings = calculateImageTimings(imageUrls, srtContent);
      console.log('Image timings:', timings);

      const clips: VideoClip[] = [];
      const totalImages = imageUrls.length;

      for (let i = 0; i < totalImages; i++) {
        const timing = timings[i];
        const progressBase = 25 + (i / totalImages) * 70;
        
        setStatus(`Processing clip ${i + 1} of ${totalImages}...`);
        setProgress(Math.round(progressBase));

        // Download image
        console.log(`[FFmpeg] Downloading image ${i + 1}...`);
        const imageData = await fetchFile(timing.imageUrl);
        await ffmpeg.writeFile(`image${i}.png`, imageData);

        // Generate video clip for this image
        const duration = Math.max(timing.duration, 1); // At least 1 second
        console.log(`[FFmpeg] Creating clip ${i + 1} with duration ${duration.toFixed(2)}s...`);

        await ffmpeg.exec([
          '-loop', '1',
          '-i', `image${i}.png`,
          '-c:v', 'libx264',
          '-t', duration.toFixed(3),
          '-pix_fmt', 'yuv420p',
          '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1',
          '-r', '30',
          '-preset', 'ultrafast',
          `clip${i}.mp4`
        ]);

        // Read output
        const data = await ffmpeg.readFile(`clip${i}.mp4`);
        const videoBlob = new Blob([new Uint8Array(data as Uint8Array)], { type: 'video/mp4' });
        const videoUrl = URL.createObjectURL(videoBlob);

        clips.push({
          index: i,
          videoUrl,
          videoBlob,
          duration,
        });

        // Cleanup this image
        try { await ffmpeg.deleteFile(`image${i}.png`); } catch {}
        try { await ffmpeg.deleteFile(`clip${i}.mp4`); } catch {}
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
  }, [loadFFmpeg, calculateImageTimings]);

  return {
    generateVideo,
    isGenerating,
    progress,
    status,
  };
}
