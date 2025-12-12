import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Get OAuth2 access token from service account
async function getAccessToken(serviceAccount: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600; // 1 hour expiry
  
  // Create JWT header and payload
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: exp,
  };
  
  // Base64url encode
  const base64url = (data: object | Uint8Array) => {
    const str = typeof data === 'object' && !(data instanceof Uint8Array) 
      ? JSON.stringify(data) 
      : new TextDecoder().decode(data as Uint8Array);
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  
  const headerB64 = base64url(header);
  const payloadB64 = base64url(payload);
  const unsignedJwt = `${headerB64}.${payloadB64}`;
  
  // Import private key and sign
  const privateKeyPem = serviceAccount.private_key;
  const pemContents = privateKeyPem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  
  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(unsignedJwt)
  );
  
  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  
  const signedJwt = `${unsignedJwt}.${signatureB64}`;
  
  // Exchange JWT for access token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedJwt,
    }),
  });
  
  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    throw new Error(`Failed to get access token: ${error}`);
  }
  
  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

// Split script into chunks for API limits (max ~5000 bytes per request)
function splitScript(script: string, maxChars: number = 4000): string[] {
  const sentences = script.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let currentChunk = '';
  
  for (const sentence of sentences) {
    if ((currentChunk + ' ' + sentence).length > maxChars && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk = currentChunk ? currentChunk + ' ' + sentence : sentence;
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

// Generate audio using Google Cloud TTS with Chirp 3
async function generateWithGoogleTTS(
  text: string,
  accessToken: string,
  voiceName: string = 'en-US-Chirp3-HD-Puck'
): Promise<Uint8Array> {
  // Extract language code from voice name (e.g., en-US-Chirp3-HD-Puck -> en-US)
  const languageCode = voiceName.split('-').slice(0, 2).join('-');
  
  const requestBody = {
    input: { text },
    voice: {
      languageCode,
      name: voiceName,
    },
    audioConfig: {
      audioEncoding: 'LINEAR16',
      sampleRateHertz: 24000,
    },
  };
  
  console.log(`Calling Google TTS with voice: ${voiceName}`);
  
  const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });
  
  if (!response.ok) {
    const error = await response.text();
    console.error('Google TTS error:', error);
    throw new Error(`Google TTS failed: ${error}`);
  }
  
  const data = await response.json();
  
  // Decode base64 audio content
  const audioContent = data.audioContent;
  const binaryString = atob(audioContent);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  return bytes;
}

// Create WAV header for PCM data
function createWavHeader(dataLength: number, sampleRate: number = 24000, channels: number = 1, bitsPerSample: number = 16): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  
  // RIFF header
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataLength, true); // File size - 8
  view.setUint32(8, 0x57415645, false); // "WAVE"
  
  // fmt chunk
  view.setUint32(12, 0x666D7420, false); // "fmt "
  view.setUint32(16, 16, true); // Chunk size
  view.setUint16(20, 1, true); // Audio format (PCM)
  view.setUint16(22, channels, true); // Channels
  view.setUint32(24, sampleRate, true); // Sample rate
  view.setUint32(28, byteRate, true); // Byte rate
  view.setUint16(32, blockAlign, true); // Block align
  view.setUint16(34, bitsPerSample, true); // Bits per sample
  
  // data chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataLength, true); // Data size
  
  return new Uint8Array(header);
}

// Strip WAV header from audio data (returns just PCM)
function stripWavHeader(audioData: Uint8Array): Uint8Array {
  // Check if it has a WAV header (starts with RIFF)
  if (audioData.length > 44 && 
      audioData[0] === 0x52 && audioData[1] === 0x49 && 
      audioData[2] === 0x46 && audioData[3] === 0x46) {
    return audioData.slice(44);
  }
  return audioData;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { script, voiceId, projectId, stream } = await req.json();
    
    if (!script) {
      return new Response(
        JSON.stringify({ error: 'Script is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get service account credentials
    const serviceAccountKey = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_KEY');
    if (!serviceAccountKey) {
      return new Response(
        JSON.stringify({ error: 'Google Service Account not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let serviceAccount;
    try {
      serviceAccount = JSON.parse(serviceAccountKey);
    } catch (e) {
      return new Response(
        JSON.stringify({ error: 'Invalid service account key format' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Clean script
    const cleanScript = script
      .replace(/\[SCENE \d+\]/g, '')
      .replace(/\[[^\]]+\]/g, '')
      .replace(/#{1,6}\s+/g, '')
      .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const wordCount = cleanScript.split(/\s+/).filter(Boolean).length;
    console.log(`Generating audio for ${wordCount} words with Google Chirp 3...`);

    // Get access token
    console.log('Getting Google OAuth2 access token...');
    const accessToken = await getAccessToken(serviceAccount);
    console.log('Access token obtained');

    // Use Chirp 3 HD voices - default to Puck (clear narrator voice)
    // Available voices: Aoede, Charon, Fenrir, Kore, Leda, Orus, Puck, Schedar, Zephyr
    const voiceName = voiceId || 'en-US-Chirp3-HD-Puck';
    
    // Split script into chunks for API limits
    const chunks = splitScript(cleanScript);
    console.log(`Split into ${chunks.length} chunks for processing`);

    if (stream) {
      // Streaming mode with progress updates
      const encoder = new TextEncoder();
      
      const responseStream = new ReadableStream({
        async start(controller) {
          try {
            const allAudioData: Uint8Array[] = [];
            
            for (let i = 0; i < chunks.length; i++) {
              const chunk = chunks[i];
              const progress = Math.round(10 + (i / chunks.length) * 75);
              
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                type: 'progress', 
                progress,
                currentChunk: i + 1,
                totalChunks: chunks.length,
                message: `Generating audio chunk ${i + 1}/${chunks.length}...`
              })}\n\n`));
              
              const audioData = await generateWithGoogleTTS(chunk, accessToken, voiceName);
              // Strip WAV header from chunks (we'll add one combined header later)
              const pcmData = stripWavHeader(audioData);
              allAudioData.push(pcmData);
              
              console.log(`Chunk ${i + 1}/${chunks.length} generated: ${pcmData.length} bytes`);
            }
            
            // Combine all audio chunks
            const totalPcmLength = allAudioData.reduce((sum, d) => sum + d.length, 0);
            const combinedPcm = new Uint8Array(totalPcmLength);
            let offset = 0;
            for (const pcm of allAudioData) {
              combinedPcm.set(pcm, offset);
              offset += pcm.length;
            }
            
            // Add WAV header
            const wavHeader = createWavHeader(totalPcmLength, 24000);
            const finalAudio = new Uint8Array(wavHeader.length + combinedPcm.length);
            finalAudio.set(wavHeader, 0);
            finalAudio.set(combinedPcm, wavHeader.length);
            
            console.log(`Combined audio: ${finalAudio.length} bytes`);
            
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
              type: 'progress', 
              progress: 90, 
              currentChunk: chunks.length,
              totalChunks: chunks.length,
              message: 'Uploading audio file...'
            })}\n\n`));

            // Upload to storage
            const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
            const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
            const supabase = createClient(supabaseUrl, supabaseKey);

            const fileName = `${projectId || crypto.randomUUID()}/voiceover.wav`;
            
            const { error: uploadError } = await supabase.storage
              .from('generated-assets')
              .upload(fileName, finalAudio, {
                contentType: 'audio/wav',
                upsert: true,
              });

            if (uploadError) {
              console.error('Upload error:', uploadError);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                type: 'error', 
                error: 'Failed to upload audio' 
              })}\n\n`));
              controller.close();
              return;
            }

            const { data: urlData } = supabase.storage
              .from('generated-assets')
              .getPublicUrl(fileName);

            console.log('Audio uploaded:', urlData.publicUrl);

            // Calculate duration (24000 Hz, 16-bit mono = 48000 bytes/sec)
            const durationSeconds = Math.round(totalPcmLength / 48000);
            console.log(`Audio duration: ${durationSeconds}s`);

            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
              type: 'complete', 
              audioUrl: urlData.publicUrl,
              duration: durationSeconds,
              size: finalAudio.length,
              totalChunks: chunks.length
            })}\n\n`));

          } catch (error) {
            console.error('Audio error:', error);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
              type: 'error', 
              error: error instanceof Error ? error.message : 'Audio generation failed' 
            })}\n\n`));
          } finally {
            controller.close();
          }
        }
      });

      return new Response(responseStream, {
        headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
      });
    }

    // Non-streaming mode
    const allAudioData: Uint8Array[] = [];
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const audioData = await generateWithGoogleTTS(chunk, accessToken, voiceName);
      const pcmData = stripWavHeader(audioData);
      allAudioData.push(pcmData);
      console.log(`Chunk ${i + 1}/${chunks.length} generated: ${pcmData.length} bytes`);
    }
    
    // Combine all audio chunks
    const totalPcmLength = allAudioData.reduce((sum, d) => sum + d.length, 0);
    const combinedPcm = new Uint8Array(totalPcmLength);
    let offset = 0;
    for (const pcm of allAudioData) {
      combinedPcm.set(pcm, offset);
      offset += pcm.length;
    }
    
    // Add WAV header
    const wavHeader = createWavHeader(totalPcmLength, 24000);
    const finalAudio = new Uint8Array(wavHeader.length + combinedPcm.length);
    finalAudio.set(wavHeader, 0);
    finalAudio.set(combinedPcm, wavHeader.length);
    
    console.log(`Combined audio: ${finalAudio.length} bytes`);

    // Upload
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const fileName = `${projectId || crypto.randomUUID()}/voiceover.wav`;
    
    const { error: uploadError } = await supabase.storage
      .from('generated-assets')
      .upload(fileName, finalAudio, {
        contentType: 'audio/wav',
        upsert: true,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return new Response(
        JSON.stringify({ error: 'Failed to upload audio' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: urlData } = supabase.storage
      .from('generated-assets')
      .getPublicUrl(fileName);

    // Calculate duration (24000 Hz, 16-bit mono = 48000 bytes/sec)
    const durationSeconds = Math.round(totalPcmLength / 48000);
    console.log(`Audio duration: ${durationSeconds}s`);

    return new Response(
      JSON.stringify({ 
        success: true,
        audioUrl: urlData.publicUrl,
        duration: durationSeconds,
        size: finalAudio.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error generating audio:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to generate audio' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
