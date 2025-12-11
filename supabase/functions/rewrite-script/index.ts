import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    // Use provided model or default to Sonnet 4.5
    const selectedModel = model || 'claude-sonnet-4-5-20250929';
    console.log(`Rewriting script with ${selectedModel}...`);

    const systemPrompt = template || `You are an expert scriptwriter specializing in historical documentary narration. 
Your task is to transform the provided transcript into a compelling, well-structured script suitable for a history video.

Guidelines:
- Maintain historical accuracy
- Use engaging, narrative language
- Write ONLY pure prose narration - no headers, no scene markers, no formatting
- The output should be word-for-word narration that can be read aloud directly
- Make it dramatic and captivating while staying educational
- The tone should be authoritative yet accessible`;

    // Use provided word count or estimate based on transcript
    const targetWords = wordCount || 15000;
    console.log(`Target word count: ${targetWords}`);
    
    // Calculate max_tokens needed (roughly 1.5 tokens per word for English + large buffer)
    // We need substantial buffer because Claude tends to stop early
    const maxTokens = Math.min(Math.ceil(targetWords * 2) + 5000, 128000);
    console.log(`Using max_tokens: ${maxTokens}`);

    if (stream) {
      // Streaming mode
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: selectedModel,
          max_tokens: maxTokens,
          stream: true,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: `You are writing a documentary narration script. This MUST be EXACTLY ${targetWords} words long. This is for a ${Math.round(targetWords / 150)}-minute video and the timing is critical.

TRANSCRIPT SOURCE:
${transcript}

YOUR TASK: Write a ${targetWords}-WORD documentary narration. Not 5000 words. Not 8000 words. EXACTLY ${targetWords} WORDS.

To achieve ${targetWords} words, you must:
- Write AT LEAST ${Math.ceil(targetWords / 300)} substantial paragraphs
- Each paragraph should be 200-400 words
- Expand EVERY event with extensive historical context
- Describe settings in vivid, cinematic detail
- Include background on all people mentioned
- Explain causes, effects, and lasting impacts
- Add comparative historical analysis
- Include emotional and human elements
- Describe the broader historical significance

FORMAT: Pure flowing prose only. No headers, no markers, no formatting.

TITLE: ${title || 'Historical Documentary'}

BEGIN YOUR ${targetWords}-WORD NARRATION NOW. DO NOT STOP UNTIL YOU REACH ${targetWords} WORDS:`
            }
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Claude API error:', response.status, errorText);
        return new Response(
          JSON.stringify({ error: `Claude API error: ${response.status}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Stream the response back with progress updates
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const reader = response.body?.getReader();
          if (!reader) {
            controller.close();
            return;
          }

          const decoder = new TextDecoder();
          let buffer = '';
          let fullScript = '';
          let tokenCount = 0;

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              
              // Process complete SSE events
              const events = buffer.split('\n\n');
              buffer = events.pop() || '';

              for (const event of events) {
                if (!event.trim()) continue;

                const lines = event.split('\n');
                let eventType = '';
                let eventData = '';

                for (const line of lines) {
                  if (line.startsWith('event: ')) {
                    eventType = line.slice(7);
                  } else if (line.startsWith('data: ')) {
                    eventData = line.slice(6);
                  }
                }

                if (eventData) {
                  try {
                    const parsed = JSON.parse(eventData);
                    
                    if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                      fullScript += parsed.delta.text;
                      tokenCount++;
                      
                      // Send progress update every 50 tokens
                      if (tokenCount % 50 === 0) {
                        const wordCount = fullScript.split(/\s+/).length;
                        const progress = Math.min(Math.round((wordCount / targetWords) * 100), 99);
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'progress', progress, wordCount })}\n\n`));
                      }
                    } else if (parsed.type === 'message_stop') {
                      // Send final result
                      const finalWordCount = fullScript.split(/\s+/).length;
                      console.log('Script rewritten successfully, length:', fullScript.length, 'words:', finalWordCount);
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                        type: 'complete', 
                        success: true,
                        script: fullScript,
                        wordCount: finalWordCount,
                        progress: 100
                      })}\n\n`));
                    } else if (parsed.type === 'error' || parsed.error) {
                      // Handle API errors
                      const errorMessage = parsed.error?.message || parsed.message || 'AI generation failed';
                      console.error('Claude streaming error:', errorMessage);
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                        type: 'error', 
                        error: errorMessage
                      })}\n\n`));
                    }
                  } catch (e) {
                    // Skip invalid JSON
                  }
                }
              }
            }
            
            // If stream ended without a complete message but we have content, send it
            if (fullScript.length > 0 && tokenCount > 0) {
              const finalWordCount = fullScript.split(/\s+/).length;
              console.log('Stream ended, sending accumulated script. Words:', finalWordCount);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                type: 'complete', 
                success: true,
                script: fullScript,
                wordCount: finalWordCount,
                progress: 100
              })}\n\n`));
            }
          } catch (streamError) {
            console.error('Stream processing error:', streamError);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
              type: 'error', 
              error: streamError instanceof Error ? streamError.message : 'Stream processing failed'
            })}\n\n`));
          } finally {
            controller.close();
          }
        }
      });

      return new Response(stream, {
        headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
      });
    } else {
      // Non-streaming mode (original behavior)
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: selectedModel,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: `Transform this transcript into a professional history documentary narration script.

Title: ${title || 'Historical Documentary'}

TRANSCRIPT:
${transcript}

MANDATORY REQUIREMENTS:
**WORD COUNT: Write AT LEAST ${targetWords} words. This is NON-NEGOTIABLE.**
**FORMAT: Output ONLY pure prose narration text. NO headers, NO section markers, NO formatting.**

Begin the narration now:`
            }
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Claude API error:', response.status, errorText);
        return new Response(
          JSON.stringify({ error: `Claude API error: ${response.status}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const data = await response.json();
      const script = data.content[0].text;

      console.log('Script rewritten successfully, length:', script.length);

      return new Response(
        JSON.stringify({ 
          success: true,
          script,
          wordCount: script.split(/\s+/).length
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
