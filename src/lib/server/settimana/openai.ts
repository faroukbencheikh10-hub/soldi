const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-5.6-luna";

export async function callOpenAiJson(systemPrompt: string, userPayload: unknown): Promise<unknown> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI settimana ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Risposta OpenAI settimana vuota");
  return JSON.parse(content);
}

export function openaiModel(): string {
  return OPENAI_MODEL;
}
