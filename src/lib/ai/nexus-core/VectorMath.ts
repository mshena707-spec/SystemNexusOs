/**
 * NEXUS PROPRIETARY VECTOR MATH ENGINE
 * Core linear algebra operations for the Nexus AI infrastructure.
 * 100% Owned, 0% Third-party reliance.
 */

export class VectorMath {
  public static dotProduct(vecA: number[], vecB: number[]): number {
    let product = 0;
    for (let i = 0; i < vecA.length; i++) {
      product += (vecA[i] || 0) * (vecB[i] || 0);
    }
    return product;
  }

  public static magnitude(vec: number[]): number {
    let sum = 0;
    for (let i = 0; i < vec.length; i++) {
      sum += (vec[i] || 0) ** 2;
    }
    return Math.sqrt(sum);
  }

  public static cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length === 0 || vecB.length === 0) return 0;
    const dot = this.dotProduct(vecA, vecB);
    const magA = this.magnitude(vecA);
    const magB = this.magnitude(vecB);
    if (magA === 0 || magB === 0) return 0;
    return dot / (magA * magB);
  }

  public static softmax(logits: number[]): number[] {
    const maxLogit = Math.max(...logits);
    const exps = logits.map(v => Math.exp(v - maxLogit)); // Stability adjustment
    const sumExps = exps.reduce((a, b) => a + b, 0);
    return exps.map(v => v / sumExps);
  }
}
