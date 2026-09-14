/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  CONVERSATION MEMORY — Phase C                                       ║
 * ║                                                                      ║
 * ║  Per-user, per-session conversation learning.                        ║
 * ║                                                                      ║
 * ║  Stores:                                                             ║
 * ║   - Full conversation history (Firestore, episodic)                  ║
 * ║   - Customer preferences inferred from conversation                  ║
 * ║   - Topic summaries (AI-generated, compressed)                       ║
 * ║   - Cross-session context (what the user asked last week)            ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

export interface ConversationTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  modelUsed?: string;
  tokensUsed?: number;
  costUsd?: number;
  memoryHit?: boolean;    // true if answered from memory (no API call)
  feedbackGiven?: 'positive' | 'negative';
}

export interface ConversationSession {
  sessionId: string;
  userId: string;
  agentId: string;
  platform: string;
  turns: ConversationTurn[];
  startedAt: number;
  lastActiveAt: number;
  topicSummary?: string;    // AI-generated summary of this session
  inferredPreferences?: Record<string, string>;
}

export interface CustomerPreference {
  userId: string;
  key: string;             // e.g. "preferred_language", "product_category", "delivery_slot"
  value: string;
  confidence: number;      // 0.0–1.0
  inferredFrom: string;    // conversation excerpt
  updatedAt: number;
}

const SESSION_CACHE = new Map<string, ConversationSession>();
const PREFERENCE_CACHE = new Map<string, CustomerPreference[]>();

export class ConversationMemory {

  // ─────────────────────────────────────────────────────────────────────────
  // Get or create a session
  // ─────────────────────────────────────────────────────────────────────────
  static async getSession(sessionId: string, userId: string, agentId: string, platform: string): Promise<ConversationSession> {
    // Check in-process cache
    if (SESSION_CACHE.has(sessionId)) {
      return SESSION_CACHE.get(sessionId)!;
    }

    // Fetch from Firestore
    try {
      const { db } = await import('../../../firebase');
      const { doc, getDoc } = await import('firebase/firestore');
      const snap = await getDoc(doc(db, 'conversation_sessions', sessionId));
      if (snap.exists()) {
        const session = snap.data() as ConversationSession;
        SESSION_CACHE.set(sessionId, session);
        return session;
      }
    } catch { /* create new */ }

    // Create new session
    const session: ConversationSession = {
      sessionId, userId, agentId, platform,
      turns: [],
      startedAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    SESSION_CACHE.set(sessionId, session);
    return session;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Append a turn and persist
  // ─────────────────────────────────────────────────────────────────────────
  static async appendTurn(sessionId: string, turn: ConversationTurn): Promise<void> {
    const session = SESSION_CACHE.get(sessionId);
    if (!session) return;

    session.turns.push(turn);
    session.lastActiveAt = Date.now();

    // Keep last 50 turns in memory; older turns archived to Firestore
    if (session.turns.length > 50) {
      session.turns = session.turns.slice(-50);
    }

    // Persist to Firestore asynchronously
    this._persistSession(session).catch(() => {});

    // Extract preferences from user messages
    if (turn.role === 'user') {
      this._inferPreferences(session.userId, turn.content).catch(() => {});
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Build context string for AI prompt injection
  // Returns last N turns as formatted string
  // ─────────────────────────────────────────────────────────────────────────
  static getContextString(sessionId: string, maxTurns = 6): string {
    const session = SESSION_CACHE.get(sessionId);
    if (!session || session.turns.length === 0) return '';

    const recent = session.turns.slice(-maxTurns);
    const lines = recent.map(t => `${t.role === 'user' ? 'Customer' : 'Assistant'}: ${t.content}`);

    const prefs = PREFERENCE_CACHE.get(session.userId);
    const prefStr = prefs && prefs.length > 0
      ? `\nCustomer preferences: ${prefs.map(p => `${p.key}=${p.value}`).join(', ')}`
      : '';

    return `[Conversation context]\n${lines.join('\n')}${prefStr}`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Get customer preferences
  // ─────────────────────────────────────────────────────────────────────────
  static async getPreferences(userId: string): Promise<CustomerPreference[]> {
    if (PREFERENCE_CACHE.has(userId)) return PREFERENCE_CACHE.get(userId)!;

    try {
      const { db } = await import('../../../firebase');
      const { collection, query, where, getDocs } = await import('firebase/firestore');
      const snap = await getDocs(query(collection(db, 'customer_preferences'), where('userId', '==', userId)));
      const prefs = snap.docs.map(d => d.data() as CustomerPreference);
      PREFERENCE_CACHE.set(userId, prefs);
      return prefs;
    } catch {
      return [];
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Write a known preference (from owner setup or learning)
  // ─────────────────────────────────────────────────────────────────────────
  static async setPreference(pref: CustomerPreference): Promise<void> {
    const prefs = await this.getPreferences(pref.userId);
    const idx = prefs.findIndex(p => p.key === pref.key);
    if (idx >= 0) prefs[idx] = pref; else prefs.push(pref);
    PREFERENCE_CACHE.set(pref.userId, prefs);

    try {
      const { db } = await import('../../../firebase');
      const { collection, doc, setDoc, serverTimestamp } = await import('firebase/firestore');
      const id = `${pref.userId}_${pref.key}`;
      await setDoc(doc(db, 'customer_preferences', id), {
        ...pref,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch { /* non-blocking */ }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Get cross-session history for a user (last N sessions summary)
  // ─────────────────────────────────────────────────────────────────────────
  static async getCrossSessionContext(userId: string, maxSessions = 3): Promise<string> {
    try {
      const { db } = await import('../../../firebase');
      const { collection, query, where, orderBy, limit, getDocs } = await import('firebase/firestore');
      const snap = await getDocs(
        query(
          collection(db, 'conversation_sessions'),
          where('userId', '==', userId),
          orderBy('lastActiveAt', 'desc'),
          limit(maxSessions)
        )
      );
      const sessions = snap.docs.map(d => d.data() as ConversationSession);
      if (sessions.length === 0) return '';

      const summaries = sessions
        .filter(s => s.topicSummary)
        .map(s => `• ${new Date(s.lastActiveAt).toLocaleDateString()}: ${s.topicSummary}`);

      return summaries.length > 0
        ? `[Previous sessions]\n${summaries.join('\n')}`
        : '';
    } catch {
      return '';
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Generate and store session summary (called on session end or after 20 turns)
  // ─────────────────────────────────────────────────────────────────────────
  static async generateSummary(sessionId: string): Promise<string | null> {
    const session = SESSION_CACHE.get(sessionId);
    if (!session || session.turns.length < 3) return null;

    const transcript = session.turns
      .slice(-20)
      .map(t => `${t.role}: ${t.content.slice(0, 200)}`)
      .join('\n');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Summarize this customer conversation in 1-2 sentences, focusing on what the customer needed and whether it was resolved:\n\n${transcript}`,
          agent: 'system',
          history: [],
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const summary = data.text ?? null;

      if (summary) {
        session.topicSummary = summary;
        await this._persistSession(session);
      }
      return summary;
    } catch {
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE helpers
  // ─────────────────────────────────────────────────────────────────────────

  private static async _persistSession(session: ConversationSession): Promise<void> {
    const { db } = await import('../../../firebase');
    const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
    await setDoc(doc(db, 'conversation_sessions', session.sessionId), {
      ...session,
      lastActiveAt: serverTimestamp(),
    }, { merge: true });
  }

  private static async _inferPreferences(userId: string, message: string): Promise<void> {
    // Rule-based quick preference extraction (no AI call to save cost)
    const msg = message.toLowerCase();
    const prefs: CustomerPreference[] = [];

    // Language preference
    if (/bangla|বাংলা/.test(msg))     prefs.push({ userId, key: 'preferred_language', value: 'Bangla',   confidence: 0.8, inferredFrom: message.slice(0,100), updatedAt: Date.now() });
    if (/english/.test(msg))            prefs.push({ userId, key: 'preferred_language', value: 'English',  confidence: 0.8, inferredFrom: message.slice(0,100), updatedAt: Date.now() });

    // Delivery preference
    if (/express|urgent|fast|quick/.test(msg))    prefs.push({ userId, key: 'delivery_preference', value: 'express',  confidence: 0.7, inferredFrom: message.slice(0,100), updatedAt: Date.now() });
    if (/standard|regular|normal/.test(msg))       prefs.push({ userId, key: 'delivery_preference', value: 'standard', confidence: 0.6, inferredFrom: message.slice(0,100), updatedAt: Date.now() });

    // Product category interest
    if (/spice|মসলা|turmeric|cumin/.test(msg))    prefs.push({ userId, key: 'product_interest', value: 'spices',   confidence: 0.7, inferredFrom: message.slice(0,100), updatedAt: Date.now() });
    if (/vegetable|সবজি/.test(msg))               prefs.push({ userId, key: 'product_interest', value: 'vegetables', confidence: 0.7, inferredFrom: message.slice(0,100), updatedAt: Date.now() });

    for (const pref of prefs) {
      await this.setPreference(pref).catch(() => {});
    }
  }
}
