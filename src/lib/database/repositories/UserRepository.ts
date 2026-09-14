/**
 * USER REPOSITORY — Phase E
 * All user/profile DB access through NexusDB.
 */
import { NexusDB } from '../NexusDB';

const COLLECTION = 'users';
const PROFILES   = 'user_profiles';

export interface User {
  id?: string;
  uid?: string;
  email: string;
  displayName?: string;
  role: 'customer' | 'admin' | 'rider' | 'rep' | 'ceo';
  createdAt?: any;
}

export class UserRepository {
  static async findById(uid: string): Promise<User | null> {
    return NexusDB.get(COLLECTION, uid) as Promise<User | null>;
  }

  static async findByRole(role: string, limit = 100): Promise<User[]> {
    return NexusDB.find(COLLECTION, {
      where: [{ field: 'role', op: '==', value: role }],
      limit,
    }) as Promise<User[]>;
  }

  static async upsert(uid: string, data: Partial<User>): Promise<void> {
    return NexusDB.set(COLLECTION, uid, data, true);
  }

  static async updateRole(uid: string, role: User['role']): Promise<void> {
    return NexusDB.update(COLLECTION, uid, { role });
  }

  static async getProfile(uid: string): Promise<Record<string, any> | null> {
    return NexusDB.get(PROFILES, uid);
  }

  static async updateProfile(uid: string, data: Record<string, any>): Promise<void> {
    return NexusDB.set(PROFILES, uid, data, true);
  }
}
