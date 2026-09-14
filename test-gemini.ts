import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
ai.models.generateContent({ model: "gemini-2.5-flash", contents: "Say hi" }).then(r => console.log("OK:", r.text)).catch(e => console.log("ERR:", e.message));
