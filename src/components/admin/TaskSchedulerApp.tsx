import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, deleteDoc, doc, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { db } from '../../firebase';
import { Clock, Plus, Trash2, Calendar, Play, Settings } from 'lucide-react';
import { logAuditAction } from '../../lib/audit';

interface ScheduledTask {
  id: string;
  name: string;
  agent: string;
  trigger: string;
  parameters: string;
  status: 'active' | 'paused';
  createdAt: any;
}

export const TaskSchedulerApp = () => {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<{ taskId: string; output: string } | null>(null);
  const [formData, setFormData] = useState<Partial<ScheduledTask>>({
    status: 'active',
    agent: 'cto',
    trigger: 'daily'
  });

  const auth = { Authorization: `Bearer ${(window as any).__NEXUS_ADMIN_SECRET__ ?? ''}` };

  const fetchTasks = async () => {
    try {
      const q = query(collection(db, 'scheduled_tasks'), orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      const tasksData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ScheduledTask[];
      setTasks(tasksData);
    } catch (error) {
      console.error("Error fetching tasks:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const handleSave = async () => {
    if (!formData.name || !formData.parameters) {
      alert("Please fill in all required fields.");
      return;
    }

    try {
      const docRef = await addDoc(collection(db, 'scheduled_tasks'), {
        ...formData,
        createdAt: serverTimestamp()
      });
      await logAuditAction('TASK_SCHEDULED', `Scheduled task: ${formData.name} (${docRef.id})`);
      setIsAdding(false);
      setFormData({ status: 'active', agent: 'cto', trigger: 'daily' });
      fetchTasks();
    } catch (error) {
      console.error("Error saving task:", error);
      alert("Failed to save task.");
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete task "${name}"?`)) return;
    try {
      await deleteDoc(doc(db, 'scheduled_tasks', id));
      await logAuditAction('TASK_DELETED', `Deleted task: ${name} (${id})`);
      fetchTasks();
    } catch (error) {
      console.error("Error deleting task:", error);
      alert("Failed to delete task.");
    }
  };

  const runTaskNow = async (taskId: string, taskName: string) => {
    setRunningTaskId(taskId);
    setRunResult(null);
    try {
      const r = await fetch(`/api/admin/audit/run-task/${taskId}`, { method: 'POST', headers: auth });
      const d = await r.json();
      if (d.success) {
        setRunResult({ taskId, output: d.output });
        await logAuditAction('TASK_RUN_MANUAL', `Manually ran task: ${taskName} (${taskId})`);
      } else {
        setRunResult({ taskId, output: `Error: ${d.error}` });
      }
    } catch (e: any) {
      setRunResult({ taskId, output: `Error: ${e.message}` });
    }
    setRunningTaskId(null);
  };

  if (loading) {
    return <div className="p-6 text-nexus-text">Loading tasks...</div>;
  }

  return (
    <div className="p-6 h-full flex flex-col text-nexus-text overflow-hidden bg-nexus-surface">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Clock className="text-blue-500" /> Task Scheduler
        </h2>
        <button 
          onClick={() => setIsAdding(true)}
          className="bg-blue-600 hover:bg-blue-700 text-nexus-text px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
        >
          <Plus size={18} /> New Task
        </button>
      </div>

      <div className="bg-yellow-950/30 border border-yellow-800 rounded-xl p-3 mb-4 text-xs text-yellow-300">
        <strong>Note:</strong> "Run Now" actually executes the task immediately. The Trigger/Frequency field
        (hourly/daily/weekly/monthly) is not yet connected to an automatic scheduler — tasks do not run on their
        own yet. Use "Run Now" to execute manually until automatic scheduling is built.
      </div>

      {isAdding && (
        <div className="bg-nexus-surface-raised p-4 rounded-xl border border-nexus-border-strong mb-6">
          <h3 className="text-lg font-medium mb-4">Schedule New Task</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-nexus-text-muted mb-1">Task Name</label>
              <input 
                type="text" 
                className="w-full bg-nexus-surface border border-nexus-border-strong rounded p-2 text-sm"
                placeholder="e.g., Daily Sales Report"
                value={formData.name || ''}
                onChange={e => setFormData({...formData, name: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-xs text-nexus-text-muted mb-1">Target Agent</label>
              <select 
                className="w-full bg-nexus-surface border border-nexus-border-strong rounded p-2 text-sm"
                value={formData.agent || 'cto'}
                onChange={e => setFormData({...formData, agent: e.target.value})}
              >
                <option value="cto">CTO Agent (Reports/Analysis)</option>
                <option value="security">Security Agent (Audits)</option>
                <option value="customer">Customer Agent (Outreach)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-nexus-text-muted mb-1">Trigger / Frequency</label>
              <select 
                className="w-full bg-nexus-surface border border-nexus-border-strong rounded p-2 text-sm"
                value={formData.trigger || 'daily'}
                onChange={e => setFormData({...formData, trigger: e.target.value})}
              >
                <option value="hourly">Hourly</option>
                <option value="daily">Daily (Midnight)</option>
                <option value="weekly">Weekly (Sunday)</option>
                <option value="monthly">Monthly (1st)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-nexus-text-muted mb-1">Status</label>
              <select 
                className="w-full bg-nexus-surface border border-nexus-border-strong rounded p-2 text-sm"
                value={formData.status || 'active'}
                onChange={e => setFormData({...formData, status: e.target.value as any})}
              >
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-nexus-text-muted mb-1">Prompt / Parameters</label>
              <textarea 
                className="w-full bg-nexus-surface border border-nexus-border-strong rounded p-2 text-sm h-24"
                placeholder="e.g., Generate a summary of yesterday's sales and highlight top performing categories."
                value={formData.parameters || ''}
                onChange={e => setFormData({...formData, parameters: e.target.value})}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button 
              onClick={() => setIsAdding(false)}
              className="px-4 py-2 bg-nexus-surface-raised hover:bg-nexus-surface-raised rounded-lg text-sm transition-colors"
            >
              Cancel
            </button>
            <button 
              onClick={handleSave}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm transition-colors"
            >
              Save Task
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto bg-nexus-surface-raised rounded-xl border border-nexus-border-strong">
        <table className="w-full text-left border-collapse">
          <thead className="bg-nexus-surface-raised sticky top-0 z-10">
            <tr>
              <th className="p-4 border-b border-nexus-border-strong font-medium text-nexus-text-muted">Task Name</th>
              <th className="p-4 border-b border-nexus-border-strong font-medium text-nexus-text-muted">Agent</th>
              <th className="p-4 border-b border-nexus-border-strong font-medium text-nexus-text-muted">Trigger</th>
              <th className="p-4 border-b border-nexus-border-strong font-medium text-nexus-text-muted">Status</th>
              <th className="p-4 border-b border-nexus-border-strong font-medium text-nexus-text-muted text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 && !isAdding && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-nexus-text-muted">
                  No scheduled tasks found.
                </td>
              </tr>
            )}
            {tasks.map(task => (
              <React.Fragment key={task.id}>
              <tr className="border-b border-nexus-border-strong hover:bg-nexus-surface-raised transition-colors">
                <td className="p-4">
                  <div className="font-medium">{task.name}</div>
                  <div className="text-xs text-nexus-text-muted truncate max-w-xs mt-1">{task.parameters}</div>
                </td>
                <td className="p-4">
                  <span className="px-2 py-1 bg-nexus-surface-raised rounded text-xs uppercase tracking-wider">{task.agent}</span>
                </td>
                <td className="p-4">
                  <div className="flex items-center gap-1 text-sm text-nexus-text">
                    <Calendar size={14} /> {task.trigger}
                  </div>
                </td>
                <td className="p-4">
                  <span className={`px-2 py-1 rounded text-xs ${
                    task.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
                  }`}>
                    {task.status}
                  </span>
                </td>
                <td className="p-4 text-right space-x-2">
                  <button onClick={() => runTaskNow(task.id, task.name)} disabled={runningTaskId === task.id}
                    className="p-2 text-nexus-text-muted hover:text-green-400 hover:bg-green-400/10 rounded transition-colors disabled:opacity-50" title="Run Now">
                    <Play size={16} className={runningTaskId === task.id ? 'animate-pulse' : ''}/>
                  </button>
                  <button onClick={() => handleDelete(task.id, task.name)} className="p-2 text-nexus-text-muted hover:text-red-400 hover:bg-red-400/10 rounded transition-colors" title="Delete">
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
              {runResult?.taskId === task.id && (
                <tr className="bg-nexus-void">
                  <td colSpan={5} className="p-4 text-xs text-nexus-text font-mono whitespace-pre-wrap border-b border-nexus-border-strong">
                    <span className="text-green-400 font-bold">Output: </span>{runResult.output}
                  </td>
                </tr>
              )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
