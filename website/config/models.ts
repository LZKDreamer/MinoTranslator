export const models = {
  agnes: {
    name: "Agnes AI",
    url: "https://platform.agnes-ai.com/settings/apiKeys",
    homeUrl: "https://agnes-ai.com",
    isFree: true
  },
  supported: [
    { name: "DeepSeek", url: "https://platform.deepseek.com/" },
    { name: "OpenAI", url: "https://platform.openai.com/" },
    { name: "Gemini", url: "https://ai.google.dev/" }
  ] as const
} as const;
