import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Claude Sonnet 4.5 has a max output of ~16k tokens per call
// We need to chain calls to reach higher word counts
const MAX_TOKENS_PER_CALL = 16000;

async function generateScriptChunkStreaming(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: { role: string; content: string }[],
  onProgress: (wordCount: number, text: string) => void
): Promise<{ text: string; stopReason: string }> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS_PER_CALL,
      system: systemPrompt,
      messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${errorText}`);
  }

  let fullText = '';
  let stopReason = 'end_turn';
  let lastProgressUpdate = 0;
  
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');
  
  const decoder = new TextDecoder();
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        
        try {
          const parsed = JSON.parse(data);
          
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            fullText += parsed.delta.text;
            
            // Update progress every ~100 words
            const currentWords = fullText.split(/\s+/).filter(w => w.length > 0).length;
            if (currentWords - lastProgressUpdate >= 100) {
              onProgress(currentWords, fullText);
              lastProgressUpdate = currentWords;
            }
          }
          
          if (parsed.type === 'message_delta' && parsed.delta?.stop_reason) {
            stopReason = parsed.delta.stop_reason;
          }
        } catch {
          // Skip non-JSON lines
        }
      }
    }
  }

  return { text: fullText, stopReason };
}

async function generateScriptChunk(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: { role: string; content: string }[]
): Promise<{ text: string; stopReason: string }> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS_PER_CALL,
      system: systemPrompt,
      messages,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return {
    text: data.content[0]?.text || '',
    stopReason: data.stop_reason || 'end_turn',
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { transcript, template, title, model, stream, wordCount } = await req.json();
    
    if (!transcript) {
      return new Response(
        JSON.stringify({ error: 'Transcript is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'Anthropic API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const selectedModel = model || 'claude-sonnet-4-5-20250929';
    console.log(`Rewriting script with ${selectedModel}...`);

    const systemPrompt = template || `You are an expert scriptwriter specializing in historical documentary narration. 
Your task is to transform content into compelling, well-structured scripts suitable for history videos.

CRITICAL RULES:
- Write ONLY pure prose narration - no headers, no scene markers, no formatting
- The output should be word-for-word narration that can be read aloud directly
- Make it dramatic, captivating, and educational
- Use vivid descriptions and emotional storytelling
- When continuing a script, seamlessly continue from where you left off`;

    const targetWords = wordCount || 15000;
    console.log(`Target word count: ${targetWords}`);

    if (stream) {
      // Streaming mode with continuation loop
      const encoder = new TextEncoder();
      
      const responseStream = new ReadableStream({
        async start(controller) {
          try {
            let fullScript = '';
            let currentWordCount = 0;
            let iteration = 0;
            const maxIterations = 10; // Safety limit
            
            while (currentWordCount < targetWords && iteration < maxIterations) {
              iteration++;
              const wordsRemaining = targetWords - currentWordCount;
              console.log(`Iteration ${iteration}: Have ${currentWordCount} words, need ${wordsRemaining} more`);
              
              let messages: { role: string; content: string }[];
              
              if (iteration === 1) {
                // First iteration: start fresh
                messages = [
                  {
                    role: 'user',
                    content: `Write a ${targetWords}-word documentary narration based on this transcript. This is for a ${Math.round(targetWords / 150)}-minute video.

TRANSCRIPT:
${transcript}

TITLE: ${title || 'Historical Documentary'}

REQUIREMENTS:
- Write ${targetWords} words of pure prose narration
- No headers, no formatting, no scene markers
- Dramatic, cinematic, educational style
- Expand with rich historical context and vivid descriptions

Begin the ${targetWords}-word narration now:`
                  }
                ];
              } else {
                // Continuation: ask to continue from where we left off
                messages = [
                  {
                    role: 'user',
                    content: `Write a ${targetWords}-word documentary narration based on this transcript.

TRANSCRIPT:
${transcript}

TITLE: ${title || 'Historical Documentary'}`
                  },
                  {
                    role: 'assistant',
                    content: fullScript
                  },
                  {
                    role: 'user',
                    content: `You've written ${currentWordCount} words so far. Continue writing ${wordsRemaining} more words to reach the ${targetWords} word target. 

CONTINUE SEAMLESSLY from where you left off. Do not repeat anything. Do not add headers or formatting. Just continue the narration with more content, more historical detail, more dramatic storytelling.

Continue now:`
                  }
                ];
              }

              const baseWordCount = currentWordCount;
              let lastSentProgress = -5;
              
              const result = await generateScriptChunkStreaming(
                ANTHROPIC_API_KEY,
                selectedModel,
                systemPrompt,
                messages,
                (chunkWords, _chunkText) => {
                  // Calculate total progress across all iterations
                  const totalWords = baseWordCount + chunkWords;
                  const progress = Math.min(Math.round((totalWords / targetWords) * 100), 95);
                  
                  // Send update every 5%
                  if (progress >= lastSentProgress + 5) {
                    lastSentProgress = progress;
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                      type: 'progress', 
                      progress,
                      wordCount: totalWords,
                      message: `Writing... ${totalWords}/${targetWords} words`
                    })}\n\n`));
                  }
                }
              );

              if (iteration === 1) {
                fullScript = result.text;
              } else {
                // Append the continuation
                fullScript += '\n\n' + result.text;
              }
              
              currentWordCount = fullScript.split(/\s+/).filter(w => w.length > 0).length;
              console.log(`After iteration ${iteration}: ${currentWordCount} words (stop: ${result.stopReason})`);
              
              // If the model stopped naturally and we're close enough, break
              if (result.stopReason === 'end_turn' && currentWordCount >= targetWords * 0.9) {
                console.log('Model finished naturally and we have enough words');
                break;
              }
              
              // If we got very little new content, break to avoid infinite loop
              if (iteration > 1 && result.text.split(/\s+/).length < 100) {
                console.log('Got too little new content, stopping');
                break;
              }
            }

            console.log(`Script complete: ${currentWordCount} words after ${iteration} iterations`);
            
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
              type: 'complete', 
              success: true,
              script: fullScript,
              wordCount: currentWordCount,
              progress: 100
            })}\n\n`));
            
          } catch (error) {
            console.error('Script generation error:', error);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
              type: 'error', 
              error: error instanceof Error ? error.message : 'Generation failed'
            })}\n\n`));
          } finally {
            controller.close();
          }
        }
      });

      return new Response(responseStream, {
        headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
      });
    } else {
      // Non-streaming mode with continuation loop
      let fullScript = '';
      let currentWordCount = 0;
      let iteration = 0;
      const maxIterations = 10;
      
      while (currentWordCount < targetWords && iteration < maxIterations) {
        iteration++;
        const wordsRemaining = targetWords - currentWordCount;
        console.log(`Iteration ${iteration}: Have ${currentWordCount} words, need ${wordsRemaining} more`);

        let messages: { role: string; content: string }[];
        
        if (iteration === 1) {
          messages = [
            {
              role: 'user',
              content: `Write a ${targetWords}-word documentary narration based on this transcript.

TRANSCRIPT:
${transcript}

TITLE: ${title || 'Historical Documentary'}

Write ${targetWords} words of pure prose narration. Begin now:`
            }
          ];
        } else {
          messages = [
            {
              role: 'user',
              content: `Write a ${targetWords}-word documentary narration based on this transcript.

TRANSCRIPT:
${transcript}`
            },
            {
              role: 'assistant',
              content: fullScript
            },
            {
              role: 'user',
              content: `Continue writing ${wordsRemaining} more words. Continue seamlessly:`
            }
          ];
        }

        const result = await generateScriptChunk(
          ANTHROPIC_API_KEY,
          selectedModel,
          systemPrompt,
          messages
        );

        if (iteration === 1) {
          fullScript = result.text;
        } else {
          fullScript += '\n\n' + result.text;
        }
        
        currentWordCount = fullScript.split(/\s+/).filter(w => w.length > 0).length;
        
        if (result.stopReason === 'end_turn' && currentWordCount >= targetWords * 0.9) {
          break;
        }
        
        if (iteration > 1 && result.text.split(/\s+/).length < 100) {
          break;
        }
      }

      console.log(`Script complete: ${currentWordCount} words`);

      return new Response(
        JSON.stringify({ 
          success: true,
          script: fullScript,
          wordCount: currentWordCount
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error) {
    console.error('Error rewriting script:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to rewrite script' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
