import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';

const router = Router();

// Constants
const MAX_TOKENS_PER_CALL = 16000;
const API_CALL_TIMEOUT = 1200000; // 20 minutes
const MAX_ITERATIONS = 10;
const KEEPALIVE_INTERVAL_MS = 3000;

interface GenerateScriptChunkOptions {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
}

async function generateScriptChunk(options: GenerateScriptChunkOptions): Promise<{ text: string; stopReason: string }> {
  const { apiKey, model, systemPrompt, messages } = options;

  const anthropic = new Anthropic({ apiKey });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_CALL_TIMEOUT);

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: MAX_TOKENS_PER_CALL,
      system: systemPrompt,
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

    const selectedModel = model || 'claude-sonnet-4-5';
    console.log(`🚀 [v2.0-HONEST-PROGRESS] Rewriting script with ${selectedModel}...`);

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
      // Streaming mode - NO TIMEOUT LIMITS on Railway!
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

        // Optimize for Railway: balance between speed and responsiveness
        // 8k words ≈ 45-60s per call (sweet spot for progress updates)
        const wordsPerIteration = Math.min(8000, Math.ceil(targetWords / 2));

        while (currentWordCount < targetWords && iteration < MAX_ITERATIONS) {
          iteration++;
          const wordsRemaining = targetWords - currentWordCount;
          console.log(`Iteration ${iteration}: Have ${currentWordCount} words, need ${wordsRemaining} more`);

          let messages: { role: 'user' | 'assistant'; content: string }[];

          if (iteration === 1) {
            // First iteration: start fresh
            messages = [{
              role: 'user',
              content: `Create a ${Math.min(wordsPerIteration, targetWords)}-word historical documentary script based on this content:\n\n${transcript}\n\nTitle: ${title || 'Historical Documentary'}\n\nWrite ${Math.min(wordsPerIteration, targetWords)} words of pure narration.`
            }];
          } else {
            // Continuation iterations
            messages = [
              {
                role: 'user',
                content: `Create a ${Math.min(wordsPerIteration, wordsRemaining)}-word historical documentary script based on this content:\n\n${transcript}\n\nTitle: ${title || 'Historical Documentary'}\n\nWrite ${Math.min(wordsPerIteration, wordsRemaining)} words of pure narration.`
              },
              {
                role: 'assistant',
                content: fullScript
              },
              {
                role: 'user',
                content: `Continue the script. Write exactly ${Math.min(wordsPerIteration, wordsRemaining)} more words. Continue seamlessly from where you left off - do not repeat any content.`
              }
            ];
          }

          // Send initial progress for this iteration (actual progress only)
          const currentProgress = Math.round((currentWordCount / targetWords) * 100);
          sendEvent({
            type: 'progress',
            progress: currentProgress,
            wordCount: currentWordCount,
            message: `Writing iteration ${iteration}/${Math.ceil(targetWords / wordsPerIteration)}... ${currentWordCount}/${targetWords} words`
          });

          // Keepalive pings (no fake progress - just prevent timeout)
          const keepaliveInterval = setInterval(() => {
            sendEvent({
              type: 'keepalive',
              message: `Generating...`
            });
          }, KEEPALIVE_INTERVAL_MS);

          let result;
          try {
            result = await generateScriptChunk({
              apiKey: ANTHROPIC_API_KEY,
              model: selectedModel,
              systemPrompt,
              messages
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

      // 8k words ≈ 45-60s per call (sweet spot for progress updates)
      const wordsPerIteration = Math.min(8000, Math.ceil(targetWords / 2));

      while (currentWordCount < targetWords && iteration < MAX_ITERATIONS) {
        iteration++;
        const wordsRemaining = targetWords - currentWordCount;
        console.log(`Iteration ${iteration}: Have ${currentWordCount} words, need ${wordsRemaining} more`);

        let messages: { role: 'user' | 'assistant'; content: string }[];

        if (iteration === 1) {
          messages = [{
            role: 'user',
            content: `Create a ${Math.min(wordsPerIteration, targetWords)}-word historical documentary script based on this content:\n\n${transcript}\n\nTitle: ${title || 'Historical Documentary'}\n\nWrite ${Math.min(wordsPerIteration, targetWords)} words of pure narration.`
          }];
        } else {
          messages = [
            {
              role: 'user',
              content: `Create a ${Math.min(wordsPerIteration, wordsRemaining)}-word historical documentary script based on this content:\n\n${transcript}\n\nTitle: ${title || 'Historical Documentary'}\n\nWrite ${Math.min(wordsPerIteration, wordsRemaining)} words of pure narration.`
            },
            {
              role: 'assistant',
              content: fullScript
            },
            {
              role: 'user',
              content: `Continue the script. Write exactly ${Math.min(wordsPerIteration, wordsRemaining)} more words. Continue seamlessly from where you left off - do not repeat any content.`
            }
          ];
        }

        const result = await generateScriptChunk({
          apiKey: ANTHROPIC_API_KEY,
          model: selectedModel,
          systemPrompt,
          messages
        });

        if (iteration === 1) {
          fullScript = result.text;
        } else {
          fullScript += '\n\n' + result.text;
        }

        currentWordCount = fullScript.split(/\s+/).filter(w => w.length > 0).length;
        console.log(`After iteration ${iteration}: ${currentWordCount} words`);

        if (result.stopReason === 'end_turn' && currentWordCount >= targetWords * 0.85) {
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
