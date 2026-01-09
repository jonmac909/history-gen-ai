// Audio integrity checking utility
// Detects glitches, skips, and discontinuities in WAV audio

export interface AudioIntegrityResult {
  valid: boolean;
  issues: AudioIssue[];
  stats: {
    durationSeconds: number;
    avgAmplitude: number;
    maxAmplitude: number;
    silencePercent: number;
    discontinuities: number;
  };
}

export interface AudioIssue {
  type: 'glitch' | 'skip' | 'discontinuity' | 'silence_gap' | 'clipping';
  timestamp: number;  // seconds
  severity: 'warning' | 'error';
  description: string;
}

// Check audio integrity - detect glitches, skips, and discontinuities
export function checkAudioIntegrity(wavBuffer: Buffer, options: {
  silenceThresholdMs?: number;  // Max acceptable silence gap (default 1000ms)
  glitchThresholdDb?: number;   // dB change threshold for glitch detection (default 20)
  sampleWindowMs?: number;      // Analysis window size (default 50ms)
} = {}): AudioIntegrityResult {
  const {
    silenceThresholdMs = 1000,
    glitchThresholdDb = 20,
    sampleWindowMs = 50,
  } = options;

  const issues: AudioIssue[] = [];
  const stats = {
    durationSeconds: 0,
    avgAmplitude: 0,
    maxAmplitude: 0,
    silencePercent: 0,
    discontinuities: 0,
  };

  try {
    // Find data chunk
    const dataMarker = Buffer.from('data', 'ascii');
    let dataIdx = -1;
    for (let i = 0; i <= wavBuffer.length - 4; i++) {
      if (wavBuffer.slice(i, i + 4).equals(dataMarker)) {
        dataIdx = i;
        break;
      }
    }

    if (dataIdx === -1) {
      return {
        valid: false,
        issues: [{ type: 'glitch', timestamp: 0, severity: 'error', description: 'Invalid WAV: no data chunk' }],
        stats,
      };
    }

    // Get format info
    const fmtMarker = Buffer.from('fmt ', 'ascii');
    let fmtIdx = -1;
    for (let i = 0; i <= wavBuffer.length - 4; i++) {
      if (wavBuffer.slice(i, i + 4).equals(fmtMarker)) {
        fmtIdx = i;
        break;
      }
    }

    const sampleRate = fmtIdx !== -1 ? wavBuffer.readUInt32LE(fmtIdx + 12) : 24000;
    const channels = fmtIdx !== -1 ? wavBuffer.readUInt16LE(fmtIdx + 10) : 1;
    const bitsPerSample = fmtIdx !== -1 ? wavBuffer.readUInt16LE(fmtIdx + 22) : 16;
    const bytesPerSample = bitsPerSample / 8;

    const dataSize = wavBuffer.readUInt32LE(dataIdx + 4);
    const dataStart = dataIdx + 8;
    // Cap dataEnd to actual buffer length to avoid massive allocations
    const dataEnd = Math.min(wavBuffer.length, dataStart + dataSize, dataStart + 100 * 1024 * 1024); // Max 100MB

    // Limit sample count to prevent memory issues
    const maxSamples = 10 * 1024 * 1024; // 10M samples max
    const estimatedSamples = (dataEnd - dataStart) / bytesPerSample;
    if (estimatedSamples > maxSamples) {
      console.log(`[WARN] Audio too large for integrity check (${estimatedSamples} samples), skipping detailed analysis`);
      stats.durationSeconds = estimatedSamples / (sampleRate * channels);
      return { valid: true, issues: [], stats };
    }

    // Read samples
    const samples: number[] = [];
    for (let i = dataStart; i < dataEnd - (bytesPerSample - 1); i += bytesPerSample) {
      if (bytesPerSample === 2) {
        samples.push(wavBuffer.readInt16LE(i));
      } else {
        samples.push(wavBuffer.readInt8(i) * 256);
      }
    }

    if (samples.length === 0) {
      return {
        valid: false,
        issues: [{ type: 'glitch', timestamp: 0, severity: 'error', description: 'No audio samples found' }],
        stats,
      };
    }

    stats.durationSeconds = samples.length / (sampleRate * channels);

    // Analyze in windows
    const windowSize = Math.floor(sampleRate * (sampleWindowMs / 1000));
    const numWindows = Math.floor(samples.length / windowSize);
    const silenceThreshold = 300;  // RMS below this is silence
    const clippingThreshold = 32000;  // Near max for 16-bit

    let totalAmplitude = 0;
    let silentWindows = 0;
    const windowRms: number[] = [];
    let prevRms = 0;

    for (let w = 0; w < numWindows; w++) {
      const start = w * windowSize;
      const end = start + windowSize;
      const window = samples.slice(start, end);

      // Calculate RMS
      const sumSquares = window.reduce((sum, s) => sum + s * s, 0);
      const rms = Math.sqrt(sumSquares / window.length);
      windowRms.push(rms);

      totalAmplitude += rms;
      stats.maxAmplitude = Math.max(stats.maxAmplitude, rms);

      // Detect silence
      if (rms < silenceThreshold) {
        silentWindows++;
      }

      // Detect sudden amplitude changes (glitches/skips)
      if (w > 0 && prevRms > silenceThreshold) {
        const ratio = rms / Math.max(prevRms, 1);
        const dbChange = 20 * Math.log10(ratio);

        // Sudden drop to silence (potential skip)
        if (rms < silenceThreshold && prevRms > silenceThreshold * 3) {
          const timestamp = (w * windowSize) / sampleRate;
          issues.push({
            type: 'skip',
            timestamp,
            severity: 'warning',
            description: `Sudden drop to silence at ${timestamp.toFixed(2)}s (${Math.abs(dbChange).toFixed(1)}dB drop)`,
          });
        }
        // Large amplitude discontinuity
        else if (Math.abs(dbChange) > glitchThresholdDb) {
          const timestamp = (w * windowSize) / sampleRate;
          stats.discontinuities++;
          issues.push({
            type: 'discontinuity',
            timestamp,
            severity: 'warning',
            description: `Amplitude discontinuity at ${timestamp.toFixed(2)}s (${dbChange.toFixed(1)}dB change)`,
          });
        }
      }

      // Detect clipping
      const maxInWindow = Math.max(...window.map(Math.abs));
      if (maxInWindow >= clippingThreshold) {
        const timestamp = (w * windowSize) / sampleRate;
        issues.push({
          type: 'clipping',
          timestamp,
          severity: 'warning',
          description: `Potential clipping at ${timestamp.toFixed(2)}s (amplitude ${maxInWindow})`,
        });
      }

      prevRms = rms;
    }

    stats.avgAmplitude = numWindows > 0 ? totalAmplitude / numWindows : 0;
    stats.silencePercent = numWindows > 0 ? (silentWindows / numWindows) * 100 : 0;

    // Detect extended silence gaps (potential segment boundary issues)
    let consecutiveSilent = 0;
    const silenceThresholdWindows = Math.ceil((silenceThresholdMs / 1000) / (sampleWindowMs / 1000));

    for (let w = 0; w < numWindows; w++) {
      if (windowRms[w] < silenceThreshold) {
        consecutiveSilent++;
        if (consecutiveSilent === silenceThresholdWindows) {
          const timestamp = ((w - consecutiveSilent + 1) * windowSize) / sampleRate;
          issues.push({
            type: 'silence_gap',
            timestamp,
            severity: 'warning',
            description: `Extended silence gap starting at ${timestamp.toFixed(2)}s (>${silenceThresholdMs}ms)`,
          });
        }
      } else {
        consecutiveSilent = 0;
      }
    }

    // Determine if audio is valid (no errors, only warnings)
    const hasErrors = issues.some(i => i.severity === 'error');
    const criticalIssues = issues.filter(i =>
      i.type === 'skip' || (i.type === 'discontinuity' && i.severity === 'error')
    );

    return {
      valid: !hasErrors && criticalIssues.length === 0,
      issues,
      stats,
    };
  } catch (err) {
    return {
      valid: false,
      issues: [{
        type: 'glitch',
        timestamp: 0,
        severity: 'error',
        description: `Analysis error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      }],
      stats,
    };
  }
}

// Log audio integrity check results
export function logAudioIntegrity(result: AudioIntegrityResult, context: string): void {
  const { valid, issues, stats } = result;

  console.log(`[INFO] Audio integrity check [${context}]:`);
  console.log(`[INFO]   Duration: ${stats.durationSeconds.toFixed(2)}s`);
  console.log(`[INFO]   Avg amplitude: ${stats.avgAmplitude.toFixed(0)}, Max: ${stats.maxAmplitude.toFixed(0)}`);
  console.log(`[INFO]   Silence: ${stats.silencePercent.toFixed(1)}%`);
  console.log(`[INFO]   Discontinuities: ${stats.discontinuities}`);
  console.log(`[INFO]   Valid: ${valid ? 'YES' : 'NO'}`);

  if (issues.length > 0) {
    console.warn(`[WARN]   Issues (${issues.length}):`);
    // Only log first 10 issues to avoid spam
    const displayIssues = issues.slice(0, 10);
    displayIssues.forEach(issue => {
      const prefix = issue.severity === 'error' ? '[ERROR]   ❌' : '[WARN]   ⚠️';
      console.warn(`${prefix} [${issue.type}] ${issue.description}`);
    });
    if (issues.length > 10) {
      console.warn(`[WARN]   ... and ${issues.length - 10} more issues`);
    }
  }
}
