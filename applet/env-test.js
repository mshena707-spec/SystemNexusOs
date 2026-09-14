import { GoogleGenAI } from '@google/genai';

console.log(process.env.GEMINI_API_KEY ? "Set" : "Not Set", process.env.GEMINI_API_KEY?.substring(0, 5));
