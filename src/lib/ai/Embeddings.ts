/**
 * NEXUS EMBEDDING SERVICE — Phase 2
 * Real vector embeddings: OpenAI → Gemini → hash fallback
 */

import { NexusConfig } from '../core/config/NexusConfig';
import { logger } from '../core/logging/NexusLogger';

const log = logger.child('EmbeddingService');

class EmbeddingServiceImpl {
  private cache = new Map<string, number[]>();
  private maxCache = 1000;

  async generateEmbedding(text: string): Promise<number[]> {
    const key = text.slice(0, 120);
    if (this.cache.has(key)) return this.cache.get(key)!;

    if (NexusConfig.ai.openaiApiKey) {
      try { const e = await this._openai(text); this._cache(key,e); return e; } catch(_) {}
    }
    if (NexusConfig.ai.geminiApiKey) {
      try { const e = await this._gemini(text); this._cache(key,e); return e; } catch(_) {}
    }
    const e = this._hash(text); this._cache(key,e); return e;
  }

  async generateBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.generateEmbedding(t)));
  }

  cosineSimilarity(a: number[], b: number[]): number {
    if (!a.length || a.length !== b.length) return 0;
    let dot=0, na=0, nb=0;
    for (let i=0;i<a.length;i++){dot+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];}
    const d = Math.sqrt(na)*Math.sqrt(nb);
    return d===0?0:dot/d;
  }

  findTopK<T extends {embedding:number[]}>(q:number[],items:T[],k=5,thresh=0.6): Array<T&{score:number}> {
    return items.map(i=>({...i,score:this.cosineSimilarity(q,i.embedding)}))
      .filter(i=>i.score>=thresh).sort((a,b)=>b.score-a.score).slice(0,k);
  }

  private async _openai(text: string): Promise<number[]> {
    const r = await fetch('https://api.openai.com/v1/embeddings',{
      method:'POST',
      headers:{'Authorization':`Bearer ${NexusConfig.ai.openaiApiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({input:text.slice(0,8000),model:'text-embedding-3-small'}),
    });
    if(!r.ok) throw new Error(`OpenAI embed ${r.status}`);
    return (await r.json()).data[0].embedding;
  }

  private async _gemini(text: string): Promise<number[]> {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${NexusConfig.ai.geminiApiKey}`,
      {method:'POST',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({model:'models/text-embedding-004',content:{parts:[{text:text.slice(0,8000)}]}})}
    );
    if(!r.ok) throw new Error(`Gemini embed ${r.status}`);
    return (await r.json()).embedding.values;
  }

  private _hash(text: string): number[] {
    const v = new Array(768).fill(0);
    for(let i=0;i<text.length;i++){
      v[i%768]+=Math.sin(text.charCodeAt(i)*(i+1));
      v[(i*7+3)%768]+=Math.cos(text.charCodeAt(i)*(i+2));
    }
    const n=Math.sqrt(v.reduce((s,x)=>s+x*x,0))||1;
    return v.map(x=>x/n);
  }

  private _cache(k:string,v:number[]){
    if(this.cache.size>=this.maxCache){const f=this.cache.keys().next().value;if(f)this.cache.delete(f);}
    this.cache.set(k,v);
  }
}

export const EmbeddingService = new EmbeddingServiceImpl();
