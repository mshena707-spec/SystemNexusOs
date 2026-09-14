export class NexusCompressionEngine {
  /**
   * Compresses any JSON object or string into a highly compressed Uint8Array using native gzip.
   * This happens in milliseconds and operates stream-based.
   */
  static async compress(data: any): Promise<Uint8Array> {
    try {
      const jsonString = typeof data === 'string' ? data : JSON.stringify(data);
      const stream = new Blob([jsonString]).stream();
      // Using native CompressionStream API for ultra-fast on-the-fly compression
      const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
      const response = new Response(compressedStream);
      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer);
    } catch (error) {
      console.error("Compression Engine Error:", error);
      throw error;
    }
  }

  /**
   * Decompresses a Uint8Array back into the original JSON object or string.
   * Instantaneous reading without manual extraction overhead.
   */
  static async decompress(compressedData: Uint8Array): Promise<any> {
    try {
      const stream = new Blob([compressedData as unknown as BlobPart]).stream();
      const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
      const response = new Response(decompressedStream);
      const jsonString = await response.text();
      return JSON.parse(jsonString);
    } catch (error) {
      console.error("Decompression Engine Error:", error);
      // Fallback if parsing fails
      return null;
    }
  }

  /**
   * Helper function to calculate storage saved
   */
  static getCompressionRatio(originalSize: number, compressedSize: number): string {
    if (originalSize === 0) return '0%';
    const ratio = ((originalSize - compressedSize) / originalSize) * 100;
    return ratio.toFixed(2) + '%';
  }
}
