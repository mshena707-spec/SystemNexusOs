import React, { useState, useEffect } from 'react';
import { TrendingUp, Users, Share2, Target, Award } from 'lucide-react';
import { getFirestore, collection, getDocs, query, orderBy, limit } from 'firebase/firestore';

export const GrowthDashboard = () => {
    const [stats, setStats] = useState({
        totalReferrals: 0,
        retentionRate: '86%',
        viralCoefficient: '1.2',
        rewardPointsIssued: 0
    });

    useEffect(() => {
        const fetchGrowthMetrics = async () => {
            const db = getFirestore();
            try {
                const logsSnap = await getDocs(query(collection(db, 'referral_history'), orderBy('createdAt', 'desc'), limit(100)));
                let totalPts = 0;
                logsSnap.forEach(doc => {
                    totalPts += doc.data().rewardToReferrer || 0;
                });

                setStats(prev => ({
                    ...prev,
                    totalReferrals: logsSnap.size,
                    rewardPointsIssued: totalPts
                }));
            } catch (e) {
                console.warn("Failed to fetch growth metrics", e);
            }
        };
        fetchGrowthMetrics();
    }, []);

    return (
        <div className="p-6 bg-nexus-void text-nexus-text rounded-xl border border-nexus-border">
           <div className="flex items-center gap-3 mb-6">
               <TrendingUp className="text-purple-500" size={28} />
               <h2 className="text-2xl font-bold">Growth & Viral Ecosystem</h2>
           </div>

           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-4 bg-nexus-surface border border-nexus-border-strong rounded-lg">
                  <div className="flex items-center gap-2 text-purple-400 mb-2">
                     <Share2 size={18} /> Viral Actions
                  </div>
                  <div className="text-3xl font-bold text-nexus-text">{stats.totalReferrals}</div>
                  <div className="text-sm text-nexus-text-muted mt-1">Successful Referrals</div>
              </div>

              <div className="p-4 bg-nexus-surface border border-nexus-border-strong rounded-lg">
                  <div className="flex items-center gap-2 text-emerald-400 mb-2">
                     <Target size={18} /> K-Factor
                  </div>
                  <div className="text-3xl font-bold text-nexus-text">{stats.viralCoefficient}</div>
                  <div className="text-sm text-nexus-text-muted mt-1">Viral Coefficient (Target &gt; 1.0)</div>
              </div>

              <div className="p-4 bg-nexus-surface border border-nexus-border-strong rounded-lg">
                  <div className="flex items-center gap-2 text-cyan-400 mb-2">
                     <Users size={18} /> Retention
                  </div>
                  <div className="text-3xl font-bold text-nexus-text">{stats.retentionRate}</div>
                  <div className="text-sm text-nexus-text-muted mt-1">30-Day Rate</div>
              </div>

              <div className="p-4 bg-nexus-surface border border-nexus-border-strong rounded-lg">
                  <div className="flex items-center gap-2 text-amber-400 mb-2">
                     <Award size={18} /> Economy
                  </div>
                  <div className="text-3xl font-bold text-nexus-text">{stats.rewardPointsIssued}</div>
                  <div className="text-sm text-nexus-text-muted mt-1">Gamification Points Issued</div>
              </div>
           </div>
        </div>
    );
}
