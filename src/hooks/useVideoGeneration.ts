import { useState, useCallback } from 'react';

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

  // Create video from single image using Canvas + MediaRecorder
  const createVideoFromImage = useCallback(async (
    imageUrl: string,
    duration: number,
    onProgress?: (p: number) => void
  ): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = () => {
        // Create canvas at 1920x1080
        const canvas = document.createElement('canvas');
        canvas.width = 1920;
        canvas.height = 1080;
        const ctx = canvas.getContext('2d')!;

        // Calculate scaling to fit image
        const scale = Math.min(1920 / img.width, 1080 / img.height);
        const x = (1920 - img.width * scale) / 2;
        const y = (1080 - img.height * scale) / 2;

        // Draw black background and centered image
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, 1920, 1080);
        ctx.drawImage(img, x, y, img.width * scale, img.height * scale);

        // Use 30 fps for smooth playback
        const fps = 30;
        const stream = canvas.captureStream(fps);
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: 'video/webm;codecs=vp9',
          videoBitsPerSecond: 2000000,
        });

        const chunks: Blob[] = [];
        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunks.push(e.data);
          }
        };

        mediaRecorder.onstop = () => {
          const blob = new Blob(chunks, { type: 'video/webm' });
          resolve(blob);
        };

        mediaRecorder.onerror = (e) => {
          reject(new Error('MediaRecorder error: ' + e));
        };

        // Start recording
        mediaRecorder.start(100);

        // Record for the full duration (in real-time)
        const durationMs = duration * 1000;
        let elapsed = 0;
        
        const interval = setInterval(() => {
          elapsed += 100;
          if (onProgress) {
            onProgress(Math.min(elapsed / durationMs, 1));
          }
          
          // Keep redrawing to ensure frames are captured
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, 1920, 1080);
          ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
          
          if (elapsed >= durationMs) {
            clearInterval(interval);
            mediaRecorder.stop();
          }
        }, 100);
      };

      img.onerror = () => {
        reject(new Error('Failed to load image: ' + imageUrl));
      };

      img.src = imageUrl;
    });
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
    setStatus('Starting video generation...');

    try {
      const timings = calculateImageTimings(imageUrls, srtContent);
      console.log('Image timings:', timings);

      const clips: VideoClip[] = [];
      const totalImages = imageUrls.length;

      for (let i = 0; i < totalImages; i++) {
        const timing = timings[i];
        const baseProgress = (i / totalImages) * 100;
        
        setStatus(`Creating clip ${i + 1} of ${totalImages} (${timing.duration.toFixed(1)}s)...`);
        setProgress(Math.round(baseProgress));

        console.log(`Creating clip ${i + 1} with duration ${timing.duration.toFixed(2)}s...`);

        const videoBlob = await createVideoFromImage(
          timing.imageUrl,
          timing.duration,
          (p) => setProgress(Math.round(baseProgress + (p * 100 / totalImages)))
        );

        const videoUrl = URL.createObjectURL(videoBlob);

        clips.push({
          index: i,
          videoUrl,
          videoBlob,
          duration: timing.duration,
        });

        console.log(`Clip ${i + 1} created: ${(videoBlob.size / 1024).toFixed(1)}KB`);
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
  }, [calculateImageTimings, createVideoFromImage]);

  return {
    generateVideo,
    isGenerating,
    progress,
    status,
  };
}
