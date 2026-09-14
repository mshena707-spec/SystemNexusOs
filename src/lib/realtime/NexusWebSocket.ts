/**
 * NexusWebSocket — Real Socket.io WebSocket Server
 *
 * BEFORE: server.ts used app.listen() — no WebSocket support at all.
 * AFTER:  Full Socket.io integration with 4 namespaces:
 *
 *   /tracking      — rider GPS → customer order tracking
 *   /notifications — admin alerts, order status pushes
 *   /chat          — live customer support with AI + human handoff
 *   /fleet         — admin FleetManager real-time map
 *
 * Scales horizontally via Redis PubSub adapter (Upstash free tier).
 * Falls back to in-memory if Redis is unavailable.
 */

import { Server as SocketServer, Socket, Namespace } from 'socket.io';
import { Server as HttpServer } from 'http';

export interface RiderLocationUpdate {
  riderId: string;
  orderId?: string;
  lat: number;
  lng: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  timestamp: string;
}

export interface OrderStatusUpdate {
  orderId: string;
  status: string;
  message?: string;
  eta?: number;
  timestamp: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'customer' | 'agent' | 'ai';
  content: string;
  timestamp: string;
  agentName?: string;
}

export interface AdminNotification {
  id: string;
  type: 'order' | 'payment' | 'fraud' | 'system' | 'stock';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  timestamp: string;
}

export class NexusWebSocket {
  private static instance: NexusWebSocket | null = null;
  private io: SocketServer | null = null;

  private constructor() {}

  static getInstance(): NexusWebSocket {
    if (!NexusWebSocket.instance) {
      NexusWebSocket.instance = new NexusWebSocket();
    }
    return NexusWebSocket.instance;
  }

  async initialize(httpServer: HttpServer): Promise<void> {
    const allowedOrigins = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',')
      : ['http://localhost:3000', 'http://localhost:5173'];

    this.io = new SocketServer(httpServer, {
      cors: { origin: allowedOrigins, methods: ['GET', 'POST'], credentials: true },
      transports: ['websocket', 'polling'],
      pingTimeout: 30000,
      pingInterval: 10000,
    });

    await this.tryRedisAdapter();

    this.setupTrackingNamespace();
    this.setupNotificationsNamespace();
    this.setupChatNamespace();
    this.setupFleetNamespace();

    console.log('[NexusWebSocket] ✅ Socket.io initialized — /tracking /notifications /chat /fleet');
  }

  private async tryRedisAdapter(): Promise<void> {
    const redisUrl = process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL;
    if (!redisUrl) {
      console.log('[NexusWebSocket] No REDIS_URL — single-instance mode (in-memory)');
      return;
    }
    try {
      const { createAdapter } = await import('@socket.io/redis-adapter');
      const { createClient } = await import('redis');
      const pub = createClient({ url: redisUrl });
      const sub = pub.duplicate();
      await Promise.all([pub.connect(), sub.connect()]);
      this.io!.adapter(createAdapter(pub, sub));
      console.log('[NexusWebSocket] ✅ Redis adapter — horizontal scaling enabled');
    } catch {
      console.log('[NexusWebSocket] Redis unavailable — falling back to in-memory');
    }
  }

  private jwtAuth(socket: Socket, next: (err?: Error) => void): void {
    try {
      const token = (socket.handshake.auth?.token as string) ||
        socket.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        (socket.data as Record<string, unknown>).userId = 'guest';
        (socket.data as Record<string, unknown>).userRole = 'guest';
        next();
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { JWTService } = require('../security/auth/JWTService');
      const claims = JWTService.verify(token);
      if (!claims) { next(new Error('Invalid token')); return; }

      (socket.data as Record<string, unknown>).userId = claims.uid;
      (socket.data as Record<string, unknown>).userRole = claims.role;
      next();
    } catch { next(new Error('Auth failed')); }
  }

  private adminGuard(socket: Socket, next: (err?: Error) => void): void {
    const role = (socket.data as Record<string, unknown>).userRole;
    if (role !== 'admin' && role !== 'ceo') { next(new Error('Admin only')); return; }
    next();
  }

  // ── /tracking — Rider GPS → Customer screen ───────────────────────────────

  private setupTrackingNamespace(): void {
    const ns = this.io!.of('/tracking');
    ns.use((s, next) => this.jwtAuth(s, next));

    ns.on('connection', (socket) => {
      socket.on('track-order', async ({ orderId }: { orderId: string }) => {
        if (!orderId) return;
        await socket.join(`order:${orderId}`);
        socket.emit('tracking-joined', { orderId });
      });

      socket.on('location-update', async (data: RiderLocationUpdate) => {
        if (!data.riderId || !data.lat || !data.lng) return;

        // Save to DB
        this.persistLocation(data).catch(() => {});

        // Send to customers tracking this order
        if (data.orderId) {
          ns.to(`order:${data.orderId}`).emit('rider-location', {
            lat: data.lat, lng: data.lng,
            speed: data.speed, heading: data.heading,
            timestamp: data.timestamp,
          });
        }

        // Send to fleet admins
        this.io!.of('/fleet').to('fleet-admins').emit('rider-location-update', data);
      });
    });
  }

  // ── /notifications — Admin + User push alerts ─────────────────────────────

  private setupNotificationsNamespace(): void {
    const ns = this.io!.of('/notifications');
    ns.use((s, next) => this.jwtAuth(s, next));

    ns.on('connection', (socket) => {
      const { userId, userRole } = socket.data as { userId: string; userRole: string };

      if (userRole === 'admin' || userRole === 'ceo') {
        socket.join('admins');
      }
      if (userId && userId !== 'guest') {
        socket.join(`user:${userId}`);
      }

      socket.on('mark-read', async ({ notificationId }: { notificationId: string }) => {
        if (!notificationId) return;
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { NexusDB } = require('../database/NexusDB');
          await NexusDB.update('notifications', notificationId, { read: true });
        } catch { /* best-effort */ }
      });
    });
  }

  // ── /chat — Live support with AI + human handoff ──────────────────────────

  private setupChatNamespace(): void {
    const ns = this.io!.of('/chat');
    ns.use((s, next) => this.jwtAuth(s, next));

    ns.on('connection', (socket) => {
      const { userId, userRole } = socket.data as { userId: string; userRole: string };

      socket.on('join-session', async ({ sessionId }: { sessionId: string }) => {
        await socket.join(`session:${sessionId}`);
      });

      socket.on('message', async (msg: { sessionId: string; content: string }) => {
        if (!msg.sessionId || !msg.content) return;

        const chatMsg: ChatMessage = {
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
          sessionId: msg.sessionId,
          role: (userRole === 'admin' || userRole === 'ceo') ? 'agent' : 'customer',
          content: msg.content,
          timestamp: new Date().toISOString(),
          agentName: (userRole === 'admin') ? userId : undefined,
        };

        // Broadcast to session room
        ns.to(`session:${msg.sessionId}`).emit('message', chatMsg);

        // Persist (non-blocking)
        this.persistChatMsg(chatMsg).catch(() => {});

        // Trigger AI if customer message
        if (chatMsg.role === 'customer') {
          this.aiReply(chatMsg, ns).catch(() => {});
        }
      });

      socket.on('agent-takeover', ({ sessionId }: { sessionId: string }) => {
        if (userRole !== 'admin' && userRole !== 'ceo') return;
        ns.to(`session:${sessionId}`).emit('handoff', {
          type: 'agent', agentName: userId, timestamp: new Date().toISOString(),
        });
      });
    });
  }

  // ── /fleet — Admin real-time rider map ───────────────────────────────────

  private setupFleetNamespace(): void {
    const ns = this.io!.of('/fleet');
    ns.use((s, next) => this.jwtAuth(s, next));
    ns.use((s, next) => this.adminGuard(s, next));

    ns.on('connection', async (socket) => {
      await socket.join('fleet-admins');

      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { RiderLocationServer } = require('../delivery/RiderLocationService');
        const riders = await RiderLocationServer.getLiveRiders();
        socket.emit('initial-positions', riders);
      } catch { /* no riders yet */ }
    });
  }

  // ── Public push APIs — called from server routes ──────────────────────────

  pushOrderUpdate(orderId: string, update: Partial<OrderStatusUpdate>): void {
    if (!this.io) return;
    this.io.of('/tracking').to(`order:${orderId}`).emit('order-update', {
      orderId, ...update, timestamp: new Date().toISOString(),
    });
  }

  pushAdminNotification(notif: Omit<AdminNotification, 'timestamp'>): void {
    if (!this.io) return;
    this.io.of('/notifications').to('admins').emit('notification', {
      ...notif, timestamp: new Date().toISOString(),
    });
  }

  pushUserNotification(userId: string, notif: Partial<AdminNotification>): void {
    if (!this.io) return;
    this.io.of('/notifications').to(`user:${userId}`).emit('notification', {
      ...notif, timestamp: new Date().toISOString(),
    });
  }

  getStats(): Record<string, number> {
    if (!this.io) return {};
    return {
      tracking: this.io.of('/tracking').sockets.size,
      notifications: this.io.of('/notifications').sockets.size,
      chat: this.io.of('/chat').sockets.size,
      fleet: this.io.of('/fleet').sockets.size,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async persistLocation(data: RiderLocationUpdate): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NexusDB } = require('../database/NexusDB');
    await NexusDB.set('rider_locations', data.riderId, {
      riderId: data.riderId, lat: data.lat, lng: data.lng,
      accuracy: data.accuracy, speed: data.speed, heading: data.heading,
      timestamp: data.timestamp, source: 'websocket',
    });
    if (data.orderId) {
      await NexusDB.add('rider_breadcrumbs', {
        riderId: data.riderId, orderId: data.orderId,
        lat: data.lat, lng: data.lng, timestamp: data.timestamp,
      });
    }
  }

  private async persistChatMsg(msg: ChatMessage): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NexusDB } = require('../database/NexusDB');
    await NexusDB.set('chat_messages', msg.id, msg as unknown as Record<string, unknown>);
  }

  private async aiReply(customerMsg: ChatMessage, ns: Namespace): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { NexusUnifiedCore } = require('../core/NexusUnifiedCore');
      const res = await NexusUnifiedCore.process(customerMsg.content, {
        agentRole: 'customer_support', userId: 'ai_agent',
        systemInstruction: 'You are a concise, helpful customer support agent for Nexus Marketplace.',
      });

      const aiMsg: ChatMessage = {
        id: `ai_${Date.now()}`, sessionId: customerMsg.sessionId,
        role: 'ai', content: res.text,
        timestamp: new Date().toISOString(), agentName: 'Nexus AI',
      };

      ns.to(`session:${customerMsg.sessionId}`).emit('message', aiMsg);
      await this.persistChatMsg(aiMsg);
    } catch { /* AI unavailable — human must respond */ }
  }
}

export const nexusWS = NexusWebSocket.getInstance();
export default nexusWS;
