import { AdvisorConfig } from '../types/advisor';
import { buildSystemPrompt, getOpeningGenerationPrompt } from '../prompts/advisorPrompt';
import { API_URL } from '../utils/apiUrl';

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
}

interface ResponseMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const PROXY_URL = `${API_URL}/api/openai/stream`;

/**
 * Converts internal message format to Responses API format
 */
function convertMessagesToResponsesFormat(
  messages: Message[]
): ResponseMessage[] {
  const responseMessages: ResponseMessage[] = [];

  for (const message of messages) {
    // Skip empty messages (like placeholder streaming messages)
    if (!message.text.trim() && !message.isUser) {
      continue;
    }
    
    responseMessages.push({
      role: message.isUser ? 'user' : 'assistant',
      content: message.text,
    });
  }

  return responseMessages;
}

/**
 * Generates a streaming chat response from OpenAI
 * @param messages - Conversation history
 * @param config - Advisor configuration
 * @param userName - User's name (optional)
 * @param onChunk - Callback function called with each text chunk as it arrives
 */
export async function generateChatResponseStream(
  messages: Message[],
  config: AdvisorConfig,
  userName: string | null,
  onChunk: (chunk: string) => void
): Promise<void> {
  try {
    const systemPrompt = buildSystemPrompt(config, userName);
    const responseItems = convertMessagesToResponsesFormat(messages);

    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      // The server chooses the model and output budget; only the conversation and brief are ours.
      body: JSON.stringify({
        input: responseItems,
        instructions: systemPrompt,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: errorText };
      }
      console.error('OpenAI API Error:', errorData);
      throw new Error(`OpenAI API request failed with status ${response.status}: ${JSON.stringify(errorData)}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulatedText = ''; // Track accumulated text for full-text updates

    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          // Process any remaining buffer before finishing
          if (buffer.trim()) {
            const lines = buffer.split('\n');
            for (const line of lines) {
              if (line.trim() === '') continue;
              if (!line.startsWith('data: ')) continue;
              
              const data = line.slice(6);
              if (data === '[DONE]') break;
              
              try {
                const json = JSON.parse(data);
                if (json.type === 'response.output_text.delta' && json.delta) {
                  accumulatedText += json.delta;
                  onChunk(json.delta);
                }
              } catch (e) {
                // Ignore parse errors for final buffer
              }
            }
          }
          break;
        }

        // Decode chunk immediately
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        
        // Process complete lines immediately
        const lines = buffer.split('\n');
        
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || '';

        // Process each complete line immediately
        for (const line of lines) {
          if (line.trim() === '') continue;
          
          // Skip non-data lines
          if (!line.startsWith('data: ')) continue;
          
          const data = line.slice(6); // Remove 'data: ' prefix
          
          // Check for completion marker
          if (data === '[DONE]') {
            return;
          }

          try {
            const json = JSON.parse(data);
            
            // Responses API format: response.output_text.delta events
            // Process deltas immediately for smooth streaming
            // Handle both json.delta (string) and json.delta as a field
            if (json.type === 'response.output_text.delta') {
              const deltaText = typeof json.delta === 'string' ? json.delta : (json.delta || '');
              if (deltaText) {
                accumulatedText += deltaText;
                // Emit chunk immediately without batching
                onChunk(deltaText);
              }
              continue;
            }
            
            // Responses API format: response.output_text.done (final text)
            if (json.type === 'response.output_text.done' && json.part?.text) {
              // This is the final accumulated text, but we should have already received all deltas
              // Only use this if we somehow missed deltas
              const finalText = json.part.text;
              if (finalText.length > accumulatedText.length) {
                const remainingChunk = finalText.slice(accumulatedText.length);
                accumulatedText = finalText;
                onChunk(remainingChunk);
              }
              continue;
            }
            
            // Responses API format: response.completed (final response with full text)
            if (json.type === 'response.completed' && json.response?.output) {
              // Extract text from the completed response
              const outputItems = json.response.output;
              for (const item of outputItems) {
                if (item.type === 'message' && item.content) {
                  for (const contentPart of item.content) {
                    if (contentPart.type === 'output_text' && contentPart.text) {
                      const finalText = contentPart.text;
                      if (finalText.length > accumulatedText.length) {
                        const remainingChunk = finalText.slice(accumulatedText.length);
                        accumulatedText = finalText;
                        onChunk(remainingChunk);
                      }
                    }
                  }
                }
              }
              continue;
            }
            
            // Fallback to Chat Completions format for compatibility
            const delta = json.choices?.[0]?.delta;
            if (delta?.content) {
              onChunk(delta.content);
              continue;
            }
          } catch (parseError) {
            // Skip invalid JSON lines
            console.warn('Failed to parse SSE data:', data, parseError);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    console.error('Failed to generate chat response:', error);
    // Don't throw - let the UI handle the error gracefully
  }
}

const OPENING_FALLBACK = "Hello! I'm your Acquiro advisor. Let's get started — what's brought you here today?";

/**
 * Generates the agent's first message for the voice call using the opening prompt rules.
 * Returns a fallback string on any failure so the call can still start.
 */
export async function generateOpeningMessage(
  config: AdvisorConfig,
  userName: string | null
): Promise<string> {
  try {
    const instructions = getOpeningGenerationPrompt(config, userName);
    const input = [{ role: 'user' as const, content: 'Generate your first message now.' }];

    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input,
        instructions,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn('OpenAI opening message failed:', response.status, errText);
      return OPENING_FALLBACK;
    }

    if (!response.body) {
      return OPENING_FALLBACK;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulatedText = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ') || line.trim() === 'data: [DONE]') continue;
          const data = line.slice(6);
          if (data === '[DONE]') break;
          try {
            const json = JSON.parse(data);
            if (json.type === 'response.output_text.delta' && json.delta) {
              const text = typeof json.delta === 'string' ? json.delta : (json.delta?.text ?? '');
              if (text) accumulatedText += text;
            }
            if (json.type === 'response.output_text.done' && json.part?.text) {
              accumulatedText = json.part.text;
            }
          } catch {
            // skip parse errors
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const trimmed = accumulatedText.trim();
    return trimmed.length > 0 ? trimmed : OPENING_FALLBACK;
  } catch (error) {
    console.warn('generateOpeningMessage error:', error);
    return OPENING_FALLBACK;
  }
}
