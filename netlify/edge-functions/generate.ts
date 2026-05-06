// Streams Claude responses to the Studio.
// Hides ANTHROPIC_API_KEY server-side. Translates Anthropic SSE deltas into
// plain text chunks so the client can do simple <chat>/<html> parsing.

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const apiKey = Deno.env.get("STUDIO_ANTHROPIC_KEY");
  if (!apiKey) {
    return new Response("STUDIO_ANTHROPIC_KEY not configured", { status: 500 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { messages, system } = body;
  if (!Array.isArray(messages) || typeof system !== "string") {
    return new Response("Expected { messages: [...], system: '...' }", { status: 400 });
  }

  const anthropicReq = {
    model: "claude-sonnet-4-6",
    max_tokens: 16000,
    system: [
      { type: "text", text: system, cache_control: { type: "ephemeral" } },
    ],
    messages,
    stream: true,
  };

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(anthropicReq),
  });

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text();
    return new Response(`Anthropic error ${upstream.status}: ${errText}`, {
      status: 502,
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buf = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          const events = buf.split("\n\n");
          buf = events.pop() || "";

          for (const evt of events) {
            const dataLine = evt.split("\n").find((l) => l.startsWith("data: "));
            if (!dataLine) continue;
            const payload = dataLine.slice(6).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const parsed = JSON.parse(payload);
              if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                controller.enqueue(encoder.encode(parsed.delta.text));
              } else if (parsed.type === "message_stop") {
                // graceful end
              } else if (parsed.type === "error") {
                controller.enqueue(
                  encoder.encode(`\n\n[stream error: ${parsed.error?.message || "unknown"}]`),
                );
              }
            } catch {
              // ignore malformed event
            }
          }
        }
      } catch (err) {
        controller.enqueue(
          new TextEncoder().encode(`\n\n[stream interrupted: ${(err as Error).message}]`),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-cache, no-transform",
    },
  });
};

export const config = { path: "/api/generate" };
