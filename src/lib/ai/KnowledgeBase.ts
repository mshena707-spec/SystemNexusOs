import { EmbeddingService } from './Embeddings';

export interface FAQ {
  keywords: string[];
  answer: string;
  embedding?: number[];
}

// Seed data for the Knowledge Base
export const LOCAL_KNOWLEDGE_BASE: FAQ[] = [
  {
    keywords: ['return', 'policy', 'refund', 'send back'],
    answer: 'Our return policy allows you to return items within 30 days of delivery. Items must be in their original condition and packaging. To initiate a return, please go to your order history.'
  },
  {
    keywords: ['shipping', 'delivery', 'time', 'how long'],
    answer: 'Standard delivery takes 3-5 business days. Express delivery is available at checkout for next-day arrival. You can track your order in the Rider Dashboard.'
  },
  {
    keywords: ['size', 'fit', 'guide', 'dimensions'],
    answer: 'Please refer to the specific sizing chart or dimensions listed on the product page. If you are unsure, our AI can analyze the product details for you.'
  },
  {
    keywords: ['price', 'cost', 'discount', 'promo', 'cheap'],
    answer: 'Our prices are dynamically optimized for the best value. We occasionally offer discounts during holiday seasons. Subscribe to our newsletter for the latest promo codes.'
  },
  {
    keywords: ['company', 'about', 'contact', 'support', 'help'],
    answer: 'We are Nexus Market, dedicated to providing the best organic products and seamless e-commerce experiences. You can contact human support at support@nexusmarket.com.'
  },
  {
    keywords: ['quality', 'organic', 'authentic', 'real'],
    answer: 'All our products undergo strict quality control. Our spices and groceries are 100% certified organic and sourced directly from trusted farmers.'
  },
  {
    keywords: ['payment', 'pay', 'credit card', 'stripe', 'cash'],
    answer: 'We accept all major credit cards via Stripe, as well as digital wallets. Cash on delivery (COD) is available in select regions.'
  },
  // Rider Specific Knowledge
  {
    keywords: ['customer not answering', 'no response', 'customer unavailable'],
    answer: 'If the customer is not answering, please wait at the location for 5 minutes. Try calling twice. If still no response, mark the order as "Delivery Attempted" and return the items to the hub.'
  },
  {
    keywords: ['wrong address', 'address not found', 'bad location'],
    answer: 'If the address seems incorrect, contact the customer immediately for clarification. If they cannot be reached, contact dispatch support through the emergency channel.'
  },
  {
    keywords: ['traffic', 'jam', 'delayed', 'late'],
    answer: 'If you are stuck in traffic, please use the "Optimize Route" feature. If you will be more than 15 minutes late, send a quick update message to the customer via the app.'
  },
  {
    keywords: ['vehicle breakdown', 'flat tire', 'accident'],
    answer: 'Safety first. Pull over safely. Mark yourself as "Offline" and contact dispatch immediately for a rescue rider to take over your active orders.'
  }
];

let isKbEmbedded = false;

async function embedKnowledgeBase() {
  if (isKbEmbedded) return;
  for (const faq of LOCAL_KNOWLEDGE_BASE) {
    if (!faq.embedding) {
      // Create embedding based on both keywords (intent) and answer (context)
      const textToEmbed = `Keywords: ${faq.keywords.join(', ')}\nAnswer: ${faq.answer}`;
      faq.embedding = await EmbeddingService.generateEmbedding(textToEmbed);
    }
  }
  isKbEmbedded = true;
}

/**
 * Searches the local knowledge base for a matching answer.
 * Now uses Hybrid Search: Semantic Vector Search + Keyword Fallback
 * @param query The user's message
 * @returns The answer string if found, otherwise null
 */
export async function searchKnowledgeBaseSemantic(query: string): Promise<string | null> {
  // Try exact keyword match first (fastest)
  const lowerQuery = query.toLowerCase();
  for (const faq of LOCAL_KNOWLEDGE_BASE) {
    if (faq.keywords.some(kw => lowerQuery.includes(kw))) {
      return faq.answer;
    }
  }

  // If no fast match, ensure KB has embeddings and run semantic search
  await embedKnowledgeBase();
  
  const queryEmbedding = await EmbeddingService.generateEmbedding(query);
  if (!queryEmbedding) return null;
  
  let bestScore = 0;
  let bestAnswer: string | null = null;
  
  for (const faq of LOCAL_KNOWLEDGE_BASE) {
    if (faq.embedding) {
      const score = EmbeddingService.cosineSimilarity(queryEmbedding, faq.embedding);
      if (score > bestScore) {
        bestScore = score;
        bestAnswer = faq.answer;
      }
    }
  }
  
  // Return semantic match if confidence is reasonably high (>0.75)
  if (bestScore > 0.75) {
     return bestAnswer;
  }
  
  return null;
}

// Keep the synchronous version for backward compatibility where needed, 
// but it will only do keyword search.
export function searchKnowledgeBase(query: string): string | null {
  const lowerQuery = query.toLowerCase();
  for (const faq of LOCAL_KNOWLEDGE_BASE) {
    if (faq.keywords.some(kw => lowerQuery.includes(kw))) {
      return faq.answer;
    }
  }
  return null;
}
