/**
 * ChatMonitorApp — Real-time Chat Monitor with WebSocket
 *
 * BEFORE: Firestore-only, no real-time WebSocket, no AI/human distinction,
 *         no live update when new messages arrive.
 *
 * AFTER: Dual-source (WebSocket /chat + Firestore fallback):
 *   - WebSocket /chat namespace → live message stream
 *   - Admin can see all conversations across all channels
 *   - Color-coded by role: customer/AI/human-rep
 *   - Platform badge (WhatsApp/Telegram/web)
 *   - Sentiment indicator from CSAT data
 *   - Escalation flag for conversations needing attention
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { collection, query, orderBy, onSnapshot, limit } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import {
  MessageSquare, CheckCircle2, AlertCircle, Bot, User, Wifi, WifiOff,
  RefreshCw, Filter, MessageCircle
} from 'lucide-react';

interface MonitorMessage {
  id: string;
  userId: string;
  content: string;
  role: 'customer' | 'ai' | 'human_rep';
  agent?: string;
  platform?: string;
  timestamp: string | { toDate?: () => Date } | number;
  satisfied?: boolean;
  feedbackExplanation?: string;
}

interface ConversationSummary {
  userId: string;
  platform: string;
  lastMessage: string;
  lastRole: string;
  messageCount: number;
  hasEscalation: boolean;
  lastAt: string;
}

const parseTimestamp = (ts: MonitorMessage['timestamp']): string => {
  if (!ts) return '';
  if (typeof ts === 'string') return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (typeof ts === 'number') return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (ts && typeof ts === 'object' && 'toDate' in ts && typeof ts.toDate === 'function') {
    return ts.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return '';
};

const RoleBadge = ({ role, agent }: { role: string; agent?: string }) => {
  if (role === 'customer') return (
    <span className="flex items-center gap-1 text-[10px] text-nexus-text-muted">
      <User size={9}/> Customer
    </span>
  );
  if (role === 'human_rep') return (
    <span className="flex items-center gap-1 text-[10px] text-blue-400">
      <User size={9}/> {agent || 'Agent'}
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-[10px] text-purple-400">
      <Bot size={9}/> AI
    </span>
  );
};

export const ChatMonitorApp: React.FC = () => {
  const [allMessages, setAllMessages] = useState<MonitorMessage[]>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [filter, setFilter] = useState<'all' | 'escalated' | 'ai_only'>('all');
  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // WebSocket connection — monitor all sessions
  useEffect(() => {
    const token = (window as unknown as Record<string, unknown>).__NEXUS_ADMIN_SECRET__ as string
      || localStorage.getItem('nexus_access_token') || '';

    const socket = io('/chat', {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => setWsConnected(true));
    socket.on('disconnect', () => setWsConnected(false));

    // Admin receives all messages via WebSocket broadcast
    socket.on('message', (msg: MonitorMessage) => {
      setAllMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev;
        return [msg, ...prev].slice(0, 500); // Keep last 500 messages
      });
    });

    socketRef.current = socket;
    return () => { socket.disconnect(); };
  }, []);

  // Firestore fallback — load existing history
  useEffect(() => {
    const q = query(
      collection(db, 'messages'),
      orderBy('timestamp', 'desc'),
      limit(300)
    );
    const unsub = onSnapshot(q, (snap) => {
      const msgs: MonitorMessage[] = snap.docs.map(d => ({
        id: d.id,
        ...(d.data() as Omit<MonitorMessage, 'id'>),
      }));
      setAllMessages(prev => {
        // Merge: WebSocket messages take priority over Firestore (dedup by id)
        const wsIds = new Set(prev.map(m => m.id));
        const newMsgs = msgs.filter(m => !wsIds.has(m.id));
        return [...prev, ...newMsgs].slice(0, 500);
      });
    }, (err) => handleFirestoreError(err, OperationType.GET, 'messages'));

    return () => unsub();
  }, []);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedUser, allMessages.length]);

  // Build conversation summaries
  const conversations = useCallback((): ConversationSummary[] => {
    const map = new Map<string, ConversationSummary>();
    const sorted = [...allMessages].sort((a, b) => {
      const ta = new Date(typeof a.timestamp === 'string' ? a.timestamp : new Date()).getTime();
      const tb = new Date(typeof b.timestamp === 'string' ? b.timestamp : new Date()).getTime();
      return tb - ta;
    });

    for (const msg of sorted) {
      if (!msg.userId) continue;
      const existing = map.get(msg.userId);
      if (!existing) {
        map.set(msg.userId, {
          userId: msg.userId,
          platform: msg.platform || 'web',
          lastMessage: (msg.content || '').slice(0, 60),
          lastRole: msg.role,
          messageCount: 1,
          hasEscalation: msg.satisfied === false,
          lastAt: typeof msg.timestamp === 'string' ? msg.timestamp : new Date().toISOString(),
        });
      } else {
        existing.messageCount++;
        if (msg.satisfied === false) existing.hasEscalation = true;
      }
    }

    let result = Array.from(map.values());
    if (filter === 'escalated') result = result.filter(c => c.hasEscalation);
    return result;
  }, [allMessages, filter]);

  const selectedMessages = allMessages
    .filter(m => m.userId === selectedUser)
    .sort((a, b) => {
      const ta = new Date(typeof a.timestamp === 'string' ? a.timestamp : new Date()).getTime();
      const tb = new Date(typeof b.timestamp === 'string' ? b.timestamp : new Date()).getTime();
      return ta - tb;
    });

  const convList = conversations();

  return (
    <div className="flex h-full bg-nexus-void text-nexus-text text-sm overflow-hidden">
      {/* Sidebar */}
      <div className="w-72 bg-nexus-surface border-r border-nexus-border flex flex-col flex-shrink-0">
        {/* Header */}
        <div className="p-3 border-b border-nexus-border">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold flex items-center gap-2">
              <MessageSquare size={16} className="text-blue-400" /> Chat Monitor
            </h3>
            <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ${
              wsConnected ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'
            }`}>
              {wsConnected ? <Wifi size={9}/> : <WifiOff size={9}/>}
              {wsConnected ? 'Live' : 'Firestore'}
            </span>
          </div>
          {/* Filter */}
          <div className="flex gap-1">
            {(['all', 'escalated'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`text-[10px] px-2 py-1 rounded-lg transition ${
                  filter === f ? 'bg-blue-600 text-nexus-text' : 'bg-nexus-surface-raised text-nexus-text-muted hover:bg-nexus-surface-raised'
                }`}>
                {f === 'all' ? `All (${convList.length})` : `⚠️ Issues`}
              </button>
            ))}
          </div>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {convList.length === 0 ? (
            <div className="p-6 text-center text-nexus-text-faint text-xs">No conversations yet</div>
          ) : convList.map(conv => (
            <button key={conv.userId} onClick={() => setSelectedUser(conv.userId)}
              className={`w-full text-left p-3 border-b border-nexus-border transition ${
                selectedUser === conv.userId ? 'bg-blue-900/20 border-l-2 border-l-blue-500' : 'hover:bg-nexus-surface-raised'
              }`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-nexus-text truncate max-w-[140px]">
                  {conv.userId.slice(0, 12)}…
                </span>
                <div className="flex items-center gap-1">
                  {conv.hasEscalation && <AlertCircle size={11} className="text-red-400"/>}
                  <span className={`text-[9px] px-1 rounded ${
                    conv.platform === 'whatsapp' ? 'bg-green-900/30 text-green-400' :
                    conv.platform === 'telegram' ? 'bg-blue-900/30 text-blue-400' :
                    'bg-nexus-surface-raised text-nexus-text-muted'
                  }`}>{conv.platform}</span>
                </div>
              </div>
              <p className="text-[11px] text-nexus-text-muted truncate">{conv.lastMessage}</p>
              <div className="flex items-center justify-between mt-1">
                <RoleBadge role={conv.lastRole}/>
                <span className="text-[9px] text-nexus-text-faint">{conv.messageCount} msgs</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Message view */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedUser ? (
          <>
            {/* Conv header */}
            <div className="p-3 border-b border-nexus-border bg-nexus-surface flex items-center justify-between">
              <div>
                <div className="font-semibold text-xs">{selectedUser.slice(0, 20)}</div>
                <div className="text-[10px] text-nexus-text-muted">
                  {selectedMessages.length} messages · Read-only monitor view
                </div>
              </div>
              <div className="text-[10px] text-nexus-text-faint">
                {convList.find(c => c.userId === selectedUser)?.platform}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {selectedMessages.map(msg => (
                <div key={msg.id} className={`flex ${msg.role === 'customer' ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[75%] rounded-xl px-3 py-2 ${
                    msg.role === 'customer' ? 'bg-nexus-surface-raised border border-nexus-border-strong' :
                    msg.role === 'human_rep' ? 'bg-blue-900/30 border border-blue-700/30' :
                    'bg-purple-900/20 border border-purple-700/20'
                  }`}>
                    <div className="flex items-center justify-between mb-1 gap-3">
                      <RoleBadge role={msg.role} agent={msg.agent}/>
                      <span className="text-[9px] text-nexus-text-faint">{parseTimestamp(msg.timestamp)}</span>
                    </div>
                    <p className="text-xs text-nexus-text">{msg.content}</p>
                    {msg.satisfied !== undefined && (
                      <div className="mt-1.5 pt-1.5 border-t border-white/10 flex items-center gap-1 text-[10px]">
                        {msg.satisfied
                          ? <><CheckCircle2 size={10} className="text-green-400"/> <span className="text-green-400">Helpful</span></>
                          : <><AlertCircle size={10} className="text-red-400"/> <span className="text-red-400">Not helpful</span></>
                        }
                        {msg.feedbackExplanation && (
                          <span className="text-nexus-text-muted italic">· "{msg.feedbackExplanation.slice(0, 40)}"</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-center">
            <div>
              <MessageCircle size={48} className="mx-auto mb-3 text-nexus-text-faint"/>
              <p className="text-nexus-text-faint text-sm">Select a conversation to monitor</p>
              <p className="text-nexus-text-faint text-xs mt-1">
                {wsConnected ? '🟢 Live via WebSocket' : '🟡 Using Firestore'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
