export class TaintEngine {
  static markTainted(data: any): any {
    if (typeof data === 'string') {
      return `[TAINTED_DATA_START] ${data} [TAINTED_DATA_END]`;
    }
    if (typeof data === 'object' && data !== null) {
      return { ...data, _isTainted: true };
    }
    return data;
  }

  static isTainted(data: any): boolean {
    if (typeof data === 'string') {
      return data.includes('[TAINTED_DATA_START]');
    }
    if (typeof data === 'object' && data !== null) {
      return data._isTainted === true;
    }
    return false;
  }

  static sanitizeTainted(data: string): string {
    return data.replace(/\[TAINTED_DATA_START\](.*?)\[TAINTED_DATA_END\]/gs, '$1');
  }
}
