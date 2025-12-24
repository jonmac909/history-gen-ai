import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';

const router = Router();

// Constants
const MAX_TOKENS = 16000;  // Sonnet supports 16k output tokens
const API_CALL_TIMEOUT = 1200000; // 20 minutes
const MAX_ITERATIONS = 10;
const KEEPALIVE_INTERVAL_MS = 15000; // Reduced keepalive frequency (was 3s, now 15s)
const WORDS_PER_ITERATION = 12000; // ~75% of 16k token capacity

interface GenerateScriptChunkOptions {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens: number; // Model-specific max tokens (Haiku: 8k, Sonnet: 16k)
  usePromptCaching?: boolean;
  onToken?: (text: string) => void; // Callback for streaming tokens
}

// Non-streaming version (for non-streaming endpoint)
async function generateScriptChunk(options: GenerateScriptChunkOptions): Promise<{ text: string; stopReason: string }> {
  const { apiKey, model, systemPrompt, messages, maxTokens, usePromptCaching } = options;

  const anthropic = new Anthropic({ apiKey });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_CALL_TIMEOUT);

  try {
    // OPTIMIZATION: Use prompt caching to avoid re-sending transcript every iteration
    const systemConfig = usePromptCaching
      ? [
          {
            type: 'text' as const,
            text: systemPrompt,
            cache_control: { type: 'ephemeral' as const }
          }
        ]
      : systemPrompt;

    const response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemConfig,
      messages,
    }, {
      signal: controller.signal as any
    });

    return {
      text: response.content[0]?.type === 'text' ? response.content[0].text : '',
      stopReason: response.stop_reason || 'end_turn',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

// Streaming version (for streaming endpoint)
async function generateScriptChunkStreaming(options: GenerateScriptChunkOptions): Promise<{ text: string; stopReason: string }> {
  const { apiKey, model, systemPrompt, messages, maxTokens, usePromptCaching, onToken } = options;

  const anthropic = new Anthropic({ apiKey });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_CALL_TIMEOUT);

  try {
    // OPTIMIZATION: Use prompt caching to avoid re-sending transcript every iteration
    const systemConfig = usePromptCaching
      ? [
          {
            type: 'text' as const,
            text: systemPrompt,
            cache_control: { type: 'ephemeral' as const }
          }
        ]
      : systemPrompt;

    let fullText = '';
    let stopReason = 'end_turn';

    // OPTIMIZATION: Token streaming for real-time progress
    const stream = await anthropic.messages.stream({
      model,
      max_tokens: maxTokens,
      system: systemConfig,
      messages,
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        const text = chunk.delta.text;
        fullText += text;
        if (onToken) {
          onToken(text); // Stream tokens to client in real-time
        }
      } else if (chunk.type === 'message_stop') {
        stopReason = 'end_turn';
      }
    }

    return { text: fullText, stopReason };
  } finally {
    clearTimeout(timeoutId);
  }
}

router.post('/', async (req: Request, res: Response) => {
  try {
    const { transcript, template, title, model, stream, wordCount } = req.body;

    if (!transcript) {
      return res.status(400).json({ error: 'Transcript is required' });
    }

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'Anthropic API key not configured' });
    }

    // Always use Sonnet 4.5 for best quality
    const selectedModel = model || 'claude-sonnet-4-5';

    console.log(`🚀 Rewriting script with ${selectedModel}...`);
    console.log(`📊 Max tokens: ${MAX_TOKENS} | Words/iteration: ${WORDS_PER_ITERATION}`);

    const systemPrompt = template || `You are an expert scriptwriter specializing in historical documentary narration.
Your task is to transform content into compelling, well-structured scripts suitable for history videos.

CRITICAL RULES:
- Write ONLY pure prose narration - no headers, no scene markers, no formatting
- The output should be word-for-word narration that can be read aloud directly
- Make it dramatic, captivating, and educational
- Use vivid descriptions and emotional storytelling
- When continuing a script, seamlessly continue from where you left off`;

    const targetWords = wordCount || 3000;
    console.log(`Target word count: ${targetWords}`);

    if (stream) {
      // Streaming mode - NO TIMEOUT LIMITS on Render!
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Timeout-Ms': API_CALL_TIMEOUT.toString(),
        'X-Max-Iterations': MAX_ITERATIONS.toString(),
        'X-Keepalive-Interval-Ms': KEEPALIVE_INTERVAL_MS.toString(),
      });

      const sendEvent = (data: any) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      try {
        let fullScript = '';
        let currentWordCount = 0;
        let iteration = 0;

        while (currentWordCount < targetWords && iteration < MAX_ITERATIONS) {
          iteration++;
          const wordsRemaining = targetWords - currentWordCount;
          console.log(`Iteration ${iteration}: Have ${currentWordCount} words, need ${wordsRemaining} more`);

          let messages: { role: 'user' | 'assistant'; content: string }[];

          if (iteration === 1) {
            // First iteration: start fresh
            const wordLimit = Math.min(WORDS_PER_ITERATION, targetWords);
            messages = [{
              role: 'user',
              content: `Create a historical documentary script based on this content:\n\n${transcript}\n\nTitle: ${title || 'Historical Documentary'}\n\nIMPORTANT: Write EXACTLY ${wordLimit} words of pure narration. Do not exceed ${wordLimit} words. Stop writing when you reach ${wordLimit} words.`
            }];
          } else {
            // Continuation iterations
            const wordLimit = Math.min(WORDS_PER_ITERATION, wordsRemaining);
            messages = [
              {
                role: 'user',
                content: `Create a historical documentary script based on this content:\n\n${transcript}\n\nTitle: ${title || 'Historical Documentary'}\n\nWrite ${wordLimit} words of pure narration.`
              },
              {
                role: 'assistant',
                content: fullScript
              },
              {
                role: 'user',
                content: `Continue the script from where you left off.

CRITICAL - DO NOT REPEAT ANY CONTENT:
- Your previous response ended with the last few sentences shown above
- Start your continuation with NEW content only
- Do NOT rewrite or paraphrase sentences you already wrote
- If you're unsure, skip ahead to genuinely new material

Write EXACTLY ${wordLimit} more words. Stop when you reach ${wordLimit} words.`
              }
            ];
          }

          // Send initial progress for this iteration (actual progress only)
          const currentProgress = Math.round((currentWordCount / targetWords) * 100);
          const estimatedIterations = Math.ceil(targetWords / WORDS_PER_ITERATION);
          sendEvent({
            type: 'progress',
            progress: currentProgress,
            wordCount: currentWordCount,
            message: `Writing iteration ${iteration}/${estimatedIterations}... ${currentWordCount}/${targetWords} words`
          });

          // OPTIMIZATION: Token streaming means we don't need frequent keepalive pings
          // Tokens stream in real-time, so only occasional keepalive needed
          const keepaliveInterval = setInterval(() => {
            sendEvent({
              type: 'keepalive',
              message: `Generating... (streaming tokens)`
            });
          }, KEEPALIVE_INTERVAL_MS);

          let result;
          try {
            const useCaching = true; // Always use caching for faster response
            console.log(`💾 Using prompt cache for iteration ${iteration} (90% cost reduction + faster!)`);

            // Track tokens for incremental progress updates
            let iterationTokens = '';
            let lastProgressUpdate = Date.now();
            const PROGRESS_UPDATE_INTERVAL = 2000; // Update progress every 2 seconds

            // OPTIMIZATION: Use streaming with token callbacks + prompt caching
            result = await generateScriptChunkStreaming({
              apiKey: ANTHROPIC_API_KEY,
              model: selectedModel,
              systemPrompt,
              messages,
              maxTokens: MAX_TOKENS,
              usePromptCaching: useCaching, // Cache transcript on subsequent iterations
              onToken: (text) => {
                // Stream tokens to client in real-time for better UX
                sendEvent({
                  type: 'token',
                  text,
                });

                // Accumulate tokens and send incremental progress updates
                iterationTokens += text;
                const now = Date.now();
                if (now - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL) {
                  lastProgressUpdate = now;

                  // Estimate current words in this iteration
                  const iterationWords = iterationTokens.split(/\s+/).filter(w => w.length > 0).length;
                  const estimatedTotal = currentWordCount + iterationWords;
                  const estimatedProgress = Math.min(Math.round((estimatedTotal / targetWords) * 100), 99);

                  sendEvent({
                    type: 'progress',
                    progress: estimatedProgress,
                    wordCount: estimatedTotal,
                    message: `Writing... ${estimatedTotal}/${targetWords} words`
                  });
                }
              }
            });
          } catch (apiError) {
            clearInterval(keepaliveInterval);
            console.error(`API error on iteration ${iteration}:`, apiError);

            // If we have some content, return what we have
            if (currentWordCount > 500) {
              console.log(`Returning partial script with ${currentWordCount} words after error`);
              sendEvent({
                type: 'complete',
                success: true,
                script: fullScript,
                wordCount: currentWordCount,
                progress: 100,
                partial: true,
                message: `Generated ${currentWordCount} words (target was ${targetWords})`
              });
              res.end();
              return;
            }
            throw apiError;
          } finally {
            clearInterval(keepaliveInterval);
          }

          if (iteration === 1) {
            fullScript = result.text;
          } else {
            fullScript += '\n\n' + result.text;
          }

          currentWordCount = fullScript.split(/\s+/).filter(w => w.length > 0).length;
          console.log(`After iteration ${iteration}: ${currentWordCount} words (stop: ${result.stopReason})`);

          // Send REAL progress update after iteration completes
          const realProgress = Math.min(Math.round((currentWordCount / targetWords) * 100), 99);
          sendEvent({
            type: 'progress',
            progress: realProgress,
            wordCount: currentWordCount,
            message: `Completed iteration ${iteration} - ${currentWordCount}/${targetWords} words`
          });

          // If the model stopped naturally and we're close enough, break
          if (result.stopReason === 'end_turn' && currentWordCount >= targetWords * 0.85) {
            console.log('Model finished naturally and we have enough words');

            // Truncate if we significantly exceeded the target (>10% overshoot)
            if (currentWordCount > targetWords * 1.1) {
              console.log(`Truncating script from ${currentWordCount} to ~${targetWords} words`);
              const words = fullScript.split(/\s+/);
              const truncatedWords = words.slice(0, targetWords);
              fullScript = truncatedWords.join(' ');

              // Ensure we end with a complete sentence
              const lastPeriod = fullScript.lastIndexOf('.');
              const lastQuestion = fullScript.lastIndexOf('?');
              const lastExclamation = fullScript.lastIndexOf('!');
              const lastSentenceEnd = Math.max(lastPeriod, lastQuestion, lastExclamation);

              if (lastSentenceEnd > fullScript.length * 0.9) {
                fullScript = fullScript.substring(0, lastSentenceEnd + 1);
              }

              currentWordCount = fullScript.split(/\s+/).filter(w => w.length > 0).length;
              console.log(`Truncated to ${currentWordCount} words`);
            }

            break;
          }

          // If we got very little new content, break to avoid infinite loop
          if (iteration > 1 && result.text.split(/\s+/).length < 100) {
            console.log('Got too little new content, stopping');
            break;
          }
        }

        console.log(`Script complete: ${currentWordCount} words after ${iteration} iterations`);

        sendEvent({
          type: 'complete',
          success: true,
          script: fullScript,
          wordCount: currentWordCount,
          progress: 100
        });

        res.end();
      } catch (error) {
        console.error('Script generation error:', error);
        sendEvent({
          type: 'error',
          error: error instanceof Error ? error.message : 'Generation failed'
        });
        res.end();
      }
    } else {
      // Non-streaming mode
      let fullScript = '';
      let currentWordCount = 0;
      let iteration = 0;

      while (currentWordCount < targetWords && iteration < MAX_ITERATIONS) {
        iteration++;
        const wordsRemaining = targetWords - currentWordCount;
        console.log(`Iteration ${iteration}: Have ${currentWordCount} words, need ${wordsRemaining} more`);

        let messages: { role: 'user' | 'assistant'; content: string }[];

        if (iteration === 1) {
          const wordLimit = Math.min(WORDS_PER_ITERATION, targetWords);
          messages = [{
            role: 'user',
            content: `Create a historical documentary script based on this content:\n\n${transcript}\n\nTitle: ${title || 'Historical Documentary'}\n\nIMPORTANT: Write EXACTLY ${wordLimit} words of pure narration. Do not exceed ${wordLimit} words. Stop writing when you reach ${wordLimit} words.`
          }];
        } else {
          const wordLimit = Math.min(WORDS_PER_ITERATION, wordsRemaining);
          messages = [
            {
              role: 'user',
              content: `Create a historical documentary script based on this content:\n\n${transcript}\n\nTitle: ${title || 'Historical Documentary'}\n\nWrite ${wordLimit} words of pure narration.`
            },
            {
              role: 'assistant',
              content: fullScript
            },
            {
              role: 'user',
              content: `Continue the script from where you left off.

CRITICAL - DO NOT REPEAT ANY CONTENT:
- Your previous response ended with the last few sentences shown above
- Start your continuation with NEW content only
- Do NOT rewrite or paraphrase sentences you already wrote
- If you're unsure, skip ahead to genuinely new material

Write EXACTLY ${wordLimit} more words. Stop when you reach ${wordLimit} words.`
            }
          ];
        }

        // OPTIMIZATION: Use prompt caching on subsequent iterations
        const result = await generateScriptChunk({
          apiKey: ANTHROPIC_API_KEY,
          model: selectedModel,
          systemPrompt,
          messages,
          maxTokens: MAX_TOKENS,
          usePromptCaching: iteration > 1 // Cache transcript on subsequent iterations
        });

        if (iteration === 1) {
          fullScript = result.text;
        } else {
          fullScript += '\n\n' + result.text;
        }

        currentWordCount = fullScript.split(/\s+/).filter(w => w.length > 0).length;
        console.log(`After iteration ${iteration}: ${currentWordCount} words`);

        if (result.stopReason === 'end_turn' && currentWordCount >= targetWords * 0.85) {
          // Truncate if we significantly exceeded the target (>10% overshoot)
          if (currentWordCount > targetWords * 1.1) {
            console.log(`Truncating script from ${currentWordCount} to ~${targetWords} words`);
            const words = fullScript.split(/\s+/);
            const truncatedWords = words.slice(0, targetWords);
            fullScript = truncatedWords.join(' ');

            // Ensure we end with a complete sentence
            const lastPeriod = fullScript.lastIndexOf('.');
            const lastQuestion = fullScript.lastIndexOf('?');
            const lastExclamation = fullScript.lastIndexOf('!');
            const lastSentenceEnd = Math.max(lastPeriod, lastQuestion, lastExclamation);

            if (lastSentenceEnd > fullScript.length * 0.9) {
              fullScript = fullScript.substring(0, lastSentenceEnd + 1);
            }

            currentWordCount = fullScript.split(/\s+/).filter(w => w.length > 0).length;
            console.log(`Truncated to ${currentWordCount} words`);
          }

          break;
        }

        if (iteration > 1 && result.text.split(/\s+/).length < 100) {
          break;
        }
      }

      res.json({
        success: true,
        script: fullScript,
        wordCount: currentWordCount
      });
    }
  } catch (error) {
    console.error('Script generation error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Generation failed'
    });
  }
});

export default router;
