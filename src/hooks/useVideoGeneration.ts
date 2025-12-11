import { useState, useRef, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

interface ImageTiming {
  imageUrl: string;
  startTime: number;
  endTime: number;
  duration: number;
}

interface VideoGenerationResult {
  success: boolean;
  videoUrl?: string;
  videoBlob?: Blob;
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

    ffmpeg.on('progress', ({ progress: p }) => {
      setProgress(Math.round(p * 100));
    });

    setStatus('Loading FFmpeg...');
    setProgress(5);
    
    // Use single-threaded version directly - more compatible across browsers
    // Multi-threaded requires SharedArrayBuffer which needs specific CORS headers
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
    
    try {
      const coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript');
      setProgress(10);
      const wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm');
      setProgress(15);
      
      await ffmpeg.load({ coreURL, wasmURL });
      setProgress(20);
    } catch (e) {
      console.error('FFmpeg load failed:', e);
      throw new Error('Failed to load FFmpeg. Please try again.');
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
    audioUrl?: string
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

      // Download and write images to FFmpeg filesystem
      setStatus('Downloading images...');
      for (let i = 0; i < imageUrls.length; i++) {
        setProgress(Math.round((i / imageUrls.length) * 30));
        const imageData = await fetchFile(imageUrls[i]);
        await ffmpeg.writeFile(`image${i}.png`, imageData);
      }

      // Download audio if provided
      let hasAudio = false;
      if (audioUrl) {
        setStatus('Downloading audio...');
        try {
          const audioData = await fetchFile(audioUrl);
          await ffmpeg.writeFile('audio.mp3', audioData);
          hasAudio = true;
        } catch (e) {
          console.warn('Failed to download audio:', e);
        }
      }

      // Create concat file for images with durations
      setStatus('Preparing video...');
      let concatContent = '';
      for (let i = 0; i < timings.length; i++) {
        concatContent += `file 'image${i}.png'\n`;
        concatContent += `duration ${timings[i].duration.toFixed(3)}\n`;
      }
      // Add last image again (required by FFmpeg concat)
      concatContent += `file 'image${timings.length - 1}.png'\n`;
      
      await ffmpeg.writeFile('concat.txt', concatContent);

      // Generate video
      setStatus('Generating video...');
      setProgress(40);

      const ffmpegArgs = [
        '-f', 'concat',
        '-safe', '0',
        '-i', 'concat.txt',
      ];

      if (hasAudio) {
        ffmpegArgs.push('-i', 'audio.mp3');
        ffmpegArgs.push('-c:a', 'aac');
        ffmpegArgs.push('-shortest');
      }

      ffmpegArgs.push(
        '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-r', '30',
        '-preset', 'ultrafast',
        'output.mp4'
      );

      await ffmpeg.exec(ffmpegArgs);

      // Read output
      setStatus('Finalizing...');
      const data = await ffmpeg.readFile('output.mp4');
      const videoBlob = new Blob([new Uint8Array(data as Uint8Array)], { type: 'video/mp4' });
      const videoUrl = URL.createObjectURL(videoBlob);

      // Cleanup
      for (let i = 0; i < imageUrls.length; i++) {
        try { await ffmpeg.deleteFile(`image${i}.png`); } catch {}
      }
      try { await ffmpeg.deleteFile('concat.txt'); } catch {}
      try { await ffmpeg.deleteFile('audio.mp3'); } catch {}
      try { await ffmpeg.deleteFile('output.mp4'); } catch {}

      setProgress(100);
      setStatus('Complete!');
      setIsGenerating(false);

      return { success: true, videoUrl, videoBlob };
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
