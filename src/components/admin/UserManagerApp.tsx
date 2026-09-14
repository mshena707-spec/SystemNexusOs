import React, { useState, useEffect } from 'react';
import { collection, getDocs, updateDoc, doc, query, orderBy } from 'firebase/firestore';
import { db } from '../../firebase';
import { User, Shield, Clock, Search, Edit2, Save, X } from 'lucide-react';
import { logAuditAction } from '../../lib/audit';

interface UserProfile {
  id: string;
  uid: string;
  email: string;
  displayName?: string;
  role: 'customer' | 'admin' | 'rider' | 'rep' | 'manager' | 'ceo' | 'vendor';
  createdAt: any;
}

export const UserManagerApp = () => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<'customer' | 'admin' | 'rider' | 'rep' | 'manager' | 'ceo' | 'vendor'>('customer');

  const fetchUsers = async () => {
    try {
      const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      const usersData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as UserProfile[];
      setUsers(usersData);
    } catch (error) {
      console.error("Error fetching users:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleEdit = (user: UserProfile) => {
    setEditingId(user.id);
    setEditRole(user.role);
  };

  const handleSave = async (id: string, email: string) => {
    try {
      await updateDoc(doc(db, 'users', id), {
        role: editRole
      });
      await logAuditAction('USER_ROLE_UPDATED', `Updated role for ${email} to ${editRole}`);
      setEditingId(null);
      fetchUsers();
    } catch (error) {
      console.error("Error updating user role:", error);
      alert("Failed to update user role.");
    }
  };

  const filteredUsers = users.filter(user => 
    user.email.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (user.displayName && user.displayName.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  if (loading) {
    return <div className="p-6 text-nexus-text">Loading users...</div>;
  }

  return (
    <div className="p-6 h-full flex flex-col text-nexus-text overflow-hidden bg-nexus-surface">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <User className="text-blue-500" /> User Management
        </h2>
        <div className="flex items-center gap-2 bg-nexus-surface-raised px-3 py-1.5 rounded-lg border border-nexus-border-strong">
          <Search size={16} className="text-nexus-text-muted" />
          <input 
            type="text" 
            placeholder="Search users..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent text-sm focus:outline-none text-nexus-text w-48"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-nexus-surface-raised rounded-xl border border-nexus-border-strong">
        <table className="w-full text-left border-collapse">
          <thead className="bg-nexus-surface-raised sticky top-0 z-10">
            <tr>
              <th className="p-4 border-b border-nexus-border-strong font-medium text-nexus-text-muted">User</th>
              <th className="p-4 border-b border-nexus-border-strong font-medium text-nexus-text-muted">Role</th>
              <th className="p-4 border-b border-nexus-border-strong font-medium text-nexus-text-muted">Joined</th>
              <th className="p-4 border-b border-nexus-border-strong font-medium text-nexus-text-muted text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map(user => (
              <tr key={user.id} className="border-b border-nexus-border-strong hover:bg-nexus-surface-raised transition-colors">
                <td className="p-4">
                  <div className="font-medium">{user.displayName || 'No Name'}</div>
                  <div className="text-sm text-nexus-text-muted">{user.email}</div>
                  <div className="text-xs text-nexus-text-muted mt-1 font-mono">{user.uid}</div>
                </td>
                <td className="p-4">
                  {editingId === user.id ? (
                    <select 
                      className="bg-nexus-surface border border-nexus-border-strong rounded p-1 text-sm text-nexus-text capitalize"
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value as 'customer' | 'admin' | 'rider' | 'rep' | 'manager' | 'ceo' | 'vendor')}
                    >
                      <option value="customer">Customer</option>
                      <option value="rider">Rider</option>
                      <option value="rep">Customer Rep</option>
                      <option value="manager">Manager</option>
                      <option value="vendor">Vendor</option>
                      <option value="admin">Admin</option>
                      <option value="ceo">CEO</option>
                    </select>
                  ) : (
                    <span className={`px-2 py-1 rounded text-xs flex items-center gap-1 w-fit capitalize ${
                      user.role === 'admin' ? 'bg-purple-500/20 text-purple-400' : 
                      user.role === 'ceo' ? 'bg-amber-500/20 text-amber-500' :
                      user.role === 'manager' ? 'bg-indigo-500/20 text-indigo-400' :
                      user.role === 'vendor' ? 'bg-orange-500/20 text-orange-400' :
                      user.role === 'rep' ? 'bg-pink-500/20 text-pink-400' :
                      user.role === 'rider' ? 'bg-green-500/20 text-green-400' : 
                      'bg-blue-500/20 text-blue-400'
                    }`}>
                      {user.role === 'admin' || user.role === 'ceo' ? <Shield size={12} /> : <User size={12} />}
                      {user.role}
                    </span>
                  )}
                </td>
                <td className="p-4 text-sm text-nexus-text">
                  <div className="flex items-center gap-1">
                    <Clock size={14} className="text-nexus-text-muted" />
                    {user.createdAt?.toDate ? user.createdAt.toDate().toLocaleDateString() : 'Unknown'}
                  </div>
                </td>
                <td className="p-4 text-right space-x-2">
                  {editingId === user.id ? (
                    <>
                      <button onClick={() => handleSave(user.id, user.email)} className="p-2 text-green-400 hover:bg-green-400/10 rounded transition-colors" title="Save">
                        <Save size={16} />
                      </button>
                      <button onClick={() => setEditingId(null)} className="p-2 text-nexus-text-muted hover:bg-gray-400/10 rounded transition-colors" title="Cancel">
                        <X size={16} />
                      </button>
                    </>
                  ) : (
                    <button onClick={() => handleEdit(user)} className="p-2 text-nexus-text-muted hover:text-blue-400 hover:bg-blue-400/10 rounded transition-colors" title="Edit Role">
                      <Edit2 size={16} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
