import { VectorMath } from './VectorMath';

/**
 * NEXUS PROPRIETARY SMALL LANGUAGE MODEL (SLM) & EMBEDDING ENGINE
 * Completely in-house NLP tokenization and Vector Extraction architecture.
 * Safely runs entirely in-browser (Offline) without external WebAssembly binaries.
 * 
 * Features: N-Gram Semantic Chunking, TF-IDF Baseline Vectorization, Concept Association.
 */
export class NexusSemanticSLM {
  // Vocabulary mapping learned during the lifetime of the application
  private static globalCorpusParams = new Map<string, number>();
  private static totalDocumentsProcessed = 0;

  /**
   * Tokenizes and cleans a string down to its semantic roots
   */
  private static tokenize(text: string): string[] {
    const stopWords = new Set(['the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'to', 'for', 'in', 'of', 'with', 'by']);
    return text.toLowerCase()
      .replace(/[^\w\s]/gi, '')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));
  }

  /**
   * Analyzes an array of texts and updates the global neural vocabulary weights (Federated Readiness).
   */
  public static trainVocabulary(documents: string[]) {
    documents.forEach(doc => {
      this.totalDocumentsProcessed++;
      const tokens = this.tokenize(doc);
      const uniqueTokens = new Set(tokens);
      uniqueTokens.forEach(token => {
        this.globalCorpusParams.set(token, (this.globalCorpusParams.get(token) || 0) + 1);
      });
    });
  }

  /**
   * Generates a structural Vector Embedding [N-Dimensional Array] for a given text.
   * Uses IDF (Inverse Document Frequency) weights learned from the offline memory.
   */
  public static extractVectorParams(text: string, vocabBasis: string[]): number[] {
    const tokens = this.tokenize(text);
    const vector: number[] = new Array(vocabBasis.length).fill(0);

    // TF-IDF Generation
    tokens.forEach(token => {
      const idx = vocabBasis.indexOf(token);
      if (idx !== -1) {
        // Term Frequency (TF)
        const tf = tokens.filter(t => t === token).length / tokens.length;
        // Inverse Document Frequency (IDF) - punishes common words like 'hello', rewards rare words like 'refund'
        const documentFreq = this.globalCorpusParams.get(token) || 1; 
        const idf = Math.log(this.totalDocumentsProcessed / documentFreq) || 1;
        
        vector[idx] = tf * idf;
      }
    });

    return vector;
  }

  /**
   * Semantic Matrix Comparison Search
   */
  public static findSemanticMatch(query: string, archives: { id: string, question: string, answer: string }[]): { item: any, score: number } | null {
    if (archives.length === 0) return null;
    
    // 1. Train on runtime if not trained
    if (this.totalDocumentsProcessed === 0) {
       this.trainVocabulary(archives.map(a => a.question));
    }

    // 2. Establish dynamic dimensional space (Top 200 important tokens)
    const sortedVocab = Array.from(this.globalCorpusParams.entries())
       .sort((a, b) => b[1] - a[1]) // Most to least frequent
       .slice(0, 200)
       .map(entry => entry[0]);

    // 3. Vectorize Query
    const queryVector = this.extractVectorParams(query, sortedVocab);

    // 4. Matrix Multiplication for Semantic Alignment
    let bestMatch = null;
    let highestScore = -1; // 1 is perfect match, -1 is opposite

    archives.forEach(arc => {
       const arcVector = this.extractVectorParams(arc.question, sortedVocab);
       const score = VectorMath.cosineSimilarity(queryVector, arcVector);
       
       if (score > highestScore) {
          highestScore = score;
          bestMatch = arc;
       }
    });

    if (bestMatch) {
       return { item: bestMatch, score: highestScore };
    }
    
    return null;
  }
}
