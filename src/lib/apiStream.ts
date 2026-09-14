export async function streamChatAPI(
  endpoint: string,
  body: any,
  onChunk: (text: string) => void,
  onDone: (response: any) => void,
  onError: (error: any) => void,
) {
  try {
    const apiResponse = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, stream: true }),
    });

    if (!apiResponse.ok) throw new Error("API request failed");

    if (
      apiResponse.headers.get("content-type")?.includes("text/event-stream")
    ) {
      const reader = apiResponse.body!.getReader();
      const decoder = new TextDecoder();
      let finalContentStr = "";
      let done = false;

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        if (readerDone) break;
        const chunkString = decoder.decode(value, { stream: true });
        const messages = chunkString.split("\n\n").filter(Boolean);

        for (const msg of messages) {
          if (msg.startsWith("data: ")) {
            const dataStr = msg.replace("data: ", "").trim();
            if (dataStr === "[DONE]") continue;
            try {
              const data = JSON.parse(dataStr);
              if (data.type === "chunk") {
                finalContentStr = data.text;
                onChunk(finalContentStr);
              } else if (data.type === "done") {
                finalContentStr = data.text || finalContentStr;
                done = true;
                onDone({
                  text: finalContentStr,
                  source: data.source,
                  confidence: data.confidence,
                });
              } else if (data.type === "error") {
                done = true;
                onError(new Error(data.error));
              }
            } catch (e) {}
          }
        }
      }
    } else {
      const response = await apiResponse.json();
      onChunk(response.text);
      onDone(response);
    }
  } catch (err) {
    onError(err);
  }
}
