import { IStorageProvider, FindOptions } from '../interfaces/IStorageProvider';
import { db } from '../../../firebase';
import { collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, getDocs, query, limit, orderBy, where as firestoreWhere, DocumentData } from 'firebase/firestore';

/**
 * Enterprise Firebase Storage Adapter (Phase E)
 * Maps universal storage commands safely to Google Cloud Firestore.
 */
export class FirebaseAdapter implements IStorageProvider {
  name = 'Google Cloud Firestore';

  async connect(): Promise<void> {
    console.log(`[FirebaseAdapter] Connected via default Firebase app.`);
  }

  async disconnect(): Promise<void> {
    // Firestore handles connections implicitly, no hard disconnect required for clients
    console.log(`[FirebaseAdapter] Disconnected.`);
  }

  async ping(): Promise<boolean> {
    try {
      // Light ping to ensure config is valid
      return !!db; 
    } catch {
      return false;
    }
  }

  async set(collectionName: string, id: string, data: any, merge: boolean = true): Promise<void> {
    if (!db) throw new Error("Firestore not initialized");
    const docRef = doc(db, collectionName, id);
    await setDoc(docRef, data, { merge });
  }

  async get(collectionName: string, id: string): Promise<any | null> {
    if (!db) throw new Error("Firestore not initialized");
    const docRef = doc(db, collectionName, id);
    const docSnap = await getDoc(docRef);
    return docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : null;
  }

  async add(collectionName: string, data: any): Promise<string> {
    if (!db) throw new Error("Firestore not initialized");
    const colRef = collection(db, collectionName);
    const docRef = await addDoc(colRef, data);
    return docRef.id;
  }

  async update(collectionName: string, id: string, data: any): Promise<void> {
    if (!db) throw new Error("Firestore not initialized");
    const docRef = doc(db, collectionName, id);
    await updateDoc(docRef, data);
  }

  async delete(collectionName: string, id: string): Promise<void> {
    if (!db) throw new Error("Firestore not initialized");
    const docRef = doc(db, collectionName, id);
    await deleteDoc(docRef);
  }

  async find(collectionName: string, options: FindOptions): Promise<any[]> {
    if (!db) throw new Error("Firestore not initialized");
    const colRef = collection(db, collectionName);
    let q = query(colRef);

    if (options.where) {
      options.where.forEach(w => {
        // We cast operators manually just in case
        q = query(q, firestoreWhere(w.field, w.operator as any, w.value));
      });
    }

    if (options.orderByField) {
      q = query(q, orderBy(options.orderByField, options.orderDirection || 'asc'));
    }

    if (options.limit) {
      q = query(q, limit(options.limit));
    }

    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }
}
