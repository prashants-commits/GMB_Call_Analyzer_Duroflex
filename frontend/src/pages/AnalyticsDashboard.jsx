import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  BarChart2, 
  MapPin, 
  Target, 
  Users, 
  Star, 
  ShoppingCart, 
  ArrowRight,
  TrendingDown,
  Activity,
  DollarSign
} from 'lucide-react';
import { fetchAnalyticsData, parseDate } from '../utils/api';

export default function AnalyticsDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState({ reports: [], filters: { stores: [], product_categories: [] } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Local Filters
  const [storeFilter, setStoreFilter] = useState('All');
  const [callTypeFilter, setCallTypeFilter] = useState('All');
  const [intentFilter, setIntentFilter] = useState('All');
  const [visitFilter, setVisitFilter] = useState('All');
  const [npsAgentFilter, setNpsAgentFilter] = useState('All');
  const [npsBrandFilter, setNpsBrandFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    fetchAnalyticsData()
      .then(setData)
      .catch(err => {
        console.error(err);
        setError('Failed to load analytics data');
      })
      .finally(() => setLoading(false));
  }, []);

  const filteredCalls = useMemo(() => {
    let result = data.reports || [];

    if (storeFilter !== 'All') result = result.filter(r => r.store_name === storeFilter);
    if (callTypeFilter !== 'All') result = result.filter(r => r.call_type === callTypeFilter);
    if (intentFilter !== 'All') result = result.filter(r => r.intent_rating === intentFilter);
    if (visitFilter !== 'All') result = result.filter(r => r.visit_rating === visitFilter);
    if (categoryFilter !== 'All') result = result.filter(r => r.product_category === categoryFilter);
    
    if (npsAgentFilter !== 'All') {
        result = result.filter(r => {
            if (npsAgentFilter === 'HIGH') return r.nps_agent >= 8;
            if (npsAgentFilter === 'MEDIUM') return r.nps_agent >= 5 && r.nps_agent < 8;
            return r.nps_agent < 5;
        });
    }

    if (npsBrandFilter !== 'All') {
        result = result.filter(r => {
            if (npsBrandFilter === 'HIGH') return r.nps_brand >= 8;
            if (npsBrandFilter === 'MEDIUM') return r.nps_brand >= 5 && r.nps_brand < 8;
            return r.nps_brand < 5;
        });
    }

    if (startDate || endDate) {
        result = result.filter(r => {
            const d = parseDate(r.call_date);
            if (!d) return false;
            
            const dTime = d.getTime();
            
            if (startDate) {
                const s = new Date(startDate);
                s.setHours(0, 0, 0, 0);
                if (dTime < s.getTime()) return false;
            }
            
            if (endDate) {
                const e = new Date(endDate);
                e.setHours(23, 59, 59, 999);
                if (dTime > e.getTime()) return false;
            }
            
            return true;
        });
    }

    return result;
  }, [data.reports, storeFilter, callTypeFilter, intentFilter, visitFilter, npsAgentFilter, npsBrandFilter, categoryFilter, startDate, endDate]);

  const metrics = useMemo(() => {
    const total = filteredCalls.length;
    const salesLeads = filteredCalls.filter(r => (r.call_objective || '').toLowerCase().includes('sales')).length;
    
    // Bad calls: High Intent but Low Agent NPS/CX
    // Let's define Low as MEDIUM or LOW (anything not HIGH)
    const badCalls = filteredCalls.filter(r => r.intent_rating === 'HIGH' && r.experience_rating !== 'HIGH');

    // Matrix counts (Purchas Intent x Agent NPS)
    const matrix = {
        HIGH: { HIGH: 0, MEDIUM: 0, LOW: 0 },
        MEDIUM: { HIGH: 0, MEDIUM: 0, LOW: 0 },
        LOW: { HIGH: 0, MEDIUM: 0, LOW: 0 }
    };

    filteredCalls.forEach(r => {
        const i = r.intent_rating;
        const e = r.experience_rating;
        if (matrix[i] && matrix[i][e] !== undefined) {
            matrix[i][e]++;
        }
    });

    // Store Performance
    const storeMap = {};
    filteredCalls.forEach(r => {
        if (!storeMap[r.store_name]) {
            storeMap[r.store_name] = { 
                name: r.store_name, city: r.city, calls: 0, badCalls: 0, 
                sumAgent: 0, sumBrand: 0, countNps: 0,
                r: 0, e: 0, l: 0, a: 0, x: 0
            };
        }
        const s = storeMap[r.store_name];
        s.calls++;
        if (r.intent_rating === 'HIGH' && r.experience_rating !== 'HIGH') s.badCalls++;
        s.sumAgent += r.nps_agent;
        s.sumBrand += r.nps_brand;
        s.countNps++;
        s.r += r.relax.r;
        s.e += r.relax.e;
        s.l += r.relax.l;
        s.a += r.relax.a;
        s.x += r.relax.x;
    });

    // Price Bucket Performance
    const priceMap = {};
    filteredCalls.forEach(r => {
        const bucket = r.price_bucket || 'Unknown';
        if (!priceMap[bucket]) {
            priceMap[bucket] = { 
                bucket, calls: 0, badCalls: 0, 
                sumAgent: 0, sumBrand: 0, countNps: 0,
                r: 0, e: 0, l: 0, a: 0, x: 0
            };
        }
        const b = priceMap[bucket];
        b.calls++;
        if (r.intent_rating === 'HIGH' && r.experience_rating !== 'HIGH') b.badCalls++;
        b.sumAgent += r.nps_agent;
        b.sumBrand += r.nps_brand;
        b.countNps++;
        b.r += r.relax.r;
        b.e += r.relax.e;
        b.l += r.relax.l;
        b.a += r.relax.a;
        b.x += r.relax.x;
    });

    return { total, salesLeads, badCallsCount: badCalls.length, matrix, storeMap, priceMap };
  }, [filteredCalls]);

  const handleMatrixClick = (intent, exp) => {
    navigate('/listing', { state: { intentFilter: intent, expFilter: exp, startDate, endDate } });
  };

  const navigateToListWithStore = (store) => {
    navigate('/listing', { state: { storeFilter: store, startDate, endDate } });
  };

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
        <p className="text-gray-500 font-bold uppercase tracking-widest text-xs">Assembling Intelligence...</p>
    </div>
  );

  if (error) return <div className="p-20 text-center text-red-500 font-bold">{error}</div>;

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <div className="max-w-[1700px] mx-auto px-8 py-10">
        
        {/* Header */}
        <div className="flex justify-between items-start mb-10">
            <div>
                <button 
                  onClick={() => navigate('/listing', { state: { startDate, endDate } })}
                  className="text-[10px] font-black text-indigo-600 mb-2 flex items-center gap-1 hover:gap-2 transition-all uppercase tracking-[0.2em]"
                >
                    View All Reports <ArrowRight className="w-3 h-3" />
                </button>
                <h1 className="text-4xl font-black text-slate-900 tracking-tight mb-2" style={{ fontFamily: "'Fraunces', serif" }}>
                    Analytics Dashboard
                </h1>
                <p className="text-slate-500 font-medium">Aggregate intelligence across Google My Business call channels</p>
            </div>
            <div className="flex gap-4">
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Selected Calls</span>
                    <span className="text-2xl font-black text-indigo-600">{filteredCalls.length}</span>
                </div>
            </div>
        </div>

        {/* Filter Toolbar */}
        <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-xl shadow-slate-200/50 flex flex-wrap gap-4 items-center mb-10">
            <div className="flex items-center gap-2 pr-4 border-r border-slate-100 mr-2">
                <BarChart2 className="w-5 h-5 text-indigo-500" />
                <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Filters</span>
            </div>
            
            <FilterSelect 
              label="Store" 
              value={storeFilter} 
              onChange={setStoreFilter} 
              options={['All', ...data.filters.stores]} 
            />
            
            <FilterSelect 
              label="Call Type" 
              value={callTypeFilter} 
              onChange={setCallTypeFilter} 
              options={['All', ...new Set(data.reports.map(r => r.call_type).filter(Boolean))]} 
            />

            <FilterSelect 
              label="Purchase Intent" 
              value={intentFilter} 
              onChange={setIntentFilter} 
              options={['All', 'HIGH', 'MEDIUM', 'LOW']} 
            />

            <FilterSelect 
              label="Visit Intent" 
              value={visitFilter} 
              onChange={setVisitFilter} 
              options={['All', 'HIGH', 'MEDIUM', 'LOW']} 
            />

            <FilterSelect 
              label="Agent NPS" 
              value={npsAgentFilter} 
              onChange={setNpsAgentFilter} 
              options={['All', 'HIGH', 'MEDIUM', 'LOW']} 
            />

            <FilterSelect 
              label="Brand NPS" 
              value={npsBrandFilter} 
              onChange={setNpsBrandFilter} 
              options={['All', 'HIGH', 'MEDIUM', 'LOW']} 
            />

            <FilterSelect 
              label="Category" 
              value={categoryFilter} 
              onChange={setCategoryFilter} 
              options={['All', ...data.filters.product_categories]} 
            />

            <div className="flex items-center gap-2 px-4 border-l border-slate-100 ml-2">
                <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">From</span>
                    <input 
                      type="date" 
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all cursor-pointer"
                    />
                </div>
                <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">To</span>
                    <input 
                      type="date" 
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all cursor-pointer"
                    />
                </div>
            </div>

            <button 
              onClick={() => {
                setStoreFilter('All'); setCallTypeFilter('All'); setIntentFilter('All');
                setVisitFilter('All'); setNpsAgentFilter('All'); setNpsBrandFilter('All');
                setCategoryFilter('All'); setStartDate(''); setEndDate('');
              }}
              className="ml-auto text-xs font-bold text-red-500 hover:text-red-700"
            >
                Reset All
            </button>
        </div>

        {/* KPI Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
            <KpiCard 
              label="Total Volume" 
              value={metrics.total} 
              subtitle="Total Analyzed Reports" 
              color="indigo" 
              icon={<Users />} 
            />
            <KpiCard 
              label="Sales Potential" 
              value={metrics.salesLeads} 
              subtitle="Primary Sales Inquiries" 
              color="emerald" 
              icon={<Target />} 
            />
            <KpiCard 
              label="Bad Experience" 
              value={metrics.badCallsCount} 
              subtitle="High Intent / Low NPS Calls" 
              color="rose" 
              icon={<TrendingDown />} 
            />
        </div>

        {/* Matrix Section */}
        <div className="mb-16">
            <div className="flex items-center gap-4 mb-8">
                <h2 className="text-2xl font-black text-slate-900" style={{ fontFamily: "'Fraunces', serif" }}>
                    Purchase Intent × Agent NPS Matrix
                </h2>
                <div className="h-0.5 flex-1 bg-slate-200/60 rounded-full"></div>
            </div>

            <div className="grid grid-cols-[180px_repeat(3,1fr)] gap-5 min-w-[900px]">
                {/* Headers */}
                <div></div>
                <div className="text-center text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] pb-2">High Agent NPS</div>
                <div className="text-center text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] pb-2">Medium Agent NPS</div>
                <div className="text-center text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] pb-2">Low Agent NPS</div>

                {/* HIGH INTENT */}
                <div className="flex items-center justify-end pr-8 text-[11px] font-black text-slate-500 uppercase tracking-[0.2em]">High Intent</div>
                <MatrixCell count={metrics.matrix.HIGH.HIGH} color="bg-[#1e4620]" onClick={() => handleMatrixClick('HIGH', 'HIGH')} />
                <MatrixCell count={metrics.matrix.HIGH.MEDIUM} color="bg-[#4a844f]" onClick={() => handleMatrixClick('HIGH', 'MEDIUM')} />
                <MatrixCell count={metrics.matrix.HIGH.LOW} color="bg-[#8c1c1c]" onClick={() => handleMatrixClick('HIGH', 'LOW')} />

                {/* MEDIUM INTENT */}
                <div className="flex items-center justify-end pr-8 text-[11px] font-black text-slate-500 uppercase tracking-[0.2em]">Medium Intent</div>
                <MatrixCell count={metrics.matrix.MEDIUM.HIGH} color="bg-[#789d38]" onClick={() => handleMatrixClick('MEDIUM', 'HIGH')} />
                <MatrixCell count={metrics.matrix.MEDIUM.MEDIUM} color="bg-[#c8a02d]" onClick={() => handleMatrixClick('MEDIUM', 'MEDIUM')} />
                <MatrixCell count={metrics.matrix.MEDIUM.LOW} color="bg-[#c4641e]" onClick={() => handleMatrixClick('MEDIUM', 'LOW')} />

                {/* LOW INTENT */}
                <div className="flex items-center justify-end pr-8 text-[11px] font-black text-slate-500 uppercase tracking-[0.2em]">Low Intent</div>
                <MatrixCell count={metrics.matrix.LOW.HIGH} color="bg-[#c8a02d]" onClick={() => handleMatrixClick('LOW', 'HIGH')} />
                <MatrixCell count={metrics.matrix.LOW.MEDIUM} color="bg-[#8b5c2a]" onClick={() => handleMatrixClick('LOW', 'MEDIUM')} />
                <MatrixCell count={metrics.matrix.LOW.LOW} color="bg-[#6b1e1a]" onClick={() => handleMatrixClick('LOW', 'LOW')} />
            </div>
        </div>

        {/* Store Performance Matrix */}
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-200/40 overflow-hidden mb-16">
            <div className="p-8 border-b border-slate-100 flex justify-between items-center">
                <div className="flex items-center gap-4">
                    <div className="bg-amber-100 p-3 rounded-2xl text-amber-600">
                        <MapPin className="w-6 h-6" />
                    </div>
                    <div>
                        <h2 className="text-xl font-black text-slate-900" style={{ fontFamily: "'Fraunces', serif" }}>Store Performance Matrix</h2>
                        <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-0.5">Weighted performance metrics per store location</p>
                    </div>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead className="bg-slate-50/50">
                        <tr>
                            <th className="p-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Store Details</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-900 uppercase tracking-widest bg-slate-100">Overall</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">Calls</th>
                            <th className="p-6 text-center text-[10px] font-bold text-rose-500 uppercase tracking-widest bg-rose-50/30">Bad Calls</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">Avg NPS (A)</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">Avg NPS (B)</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest border-l border-slate-100">R</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest">E</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest">L</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest">A</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest">X</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {Object.values(metrics.storeMap).sort((a,b) => b.calls - a.calls).map(s => {
                            // Scale 1-3 scores to 1-10 for the 10-point scale dashboard
                            const scale = (val) => (val * 3.33); 
                            const avgA = (s.sumAgent / s.countNps).toFixed(1);
                            const avgB = (s.sumBrand / s.countNps).toFixed(1);
                            const avgR = (s.r / s.calls).toFixed(1);
                            const avgE = (s.e / s.calls).toFixed(1);
                            const avgL = (s.l / s.calls).toFixed(1);
                            const avgA_R = (s.a / s.calls).toFixed(1);
                            const avgX = (s.x / s.calls).toFixed(1);
                            
                            // Overall score as a weighted blend or simple average of scaled components
                            const overall = ((scale(Number(avgR)) + scale(Number(avgE)) + scale(Number(avgL)) + scale(Number(avgA_R)) + scale(Number(avgX))) / 5).toFixed(1);

                            return (
                                <tr key={s.name} onClick={() => navigateToListWithStore(s.name)} className="group hover:bg-slate-50 transition-all cursor-pointer">
                                    <td className="p-6">
                                        <div className="font-black text-slate-900 group-hover:text-indigo-600 transition-colors uppercase tracking-tight">{s.name}</div>
                                        <div className="text-xs text-slate-400 font-bold">{s.city}</div>
                                    </td>
                                    <td className="p-6 text-center bg-slate-100/30">
                                        <span className={`inline-block px-3 py-1 rounded-xl font-black text-sm border ${getScoreClass(overall)}`}>
                                            {overall}
                                        </span>
                                    </td>
                                    <td className="p-6 text-center font-bold text-slate-600">{s.calls}</td>
                                    <td className="p-6 text-center font-black text-rose-500 bg-rose-50/20">{s.badCalls}</td>
                                    <td className="p-6 text-center font-bold text-slate-900">{avgA}</td>
                                    <td className="p-6 text-center font-bold text-slate-900">{avgB}</td>
                                    <td className="p-6 text-center text-slate-500 border-l border-slate-50">{avgR}</td>
                                    <td className="p-6 text-center text-slate-500">{avgE}</td>
                                    <td className="p-6 text-center text-slate-500">{avgL}</td>
                                    <td className="p-6 text-center text-slate-500">{avgA_R}</td>
                                    <td className="p-6 text-center text-slate-500">{avgX}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>

        {/* Price Bucket Performance */}
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-200/40 overflow-hidden">
            <div className="p-8 border-b border-slate-100 flex justify-between items-center">
                <div className="flex items-center gap-4">
                    <div className="bg-emerald-100 p-3 rounded-2xl text-emerald-600">
                        <DollarSign className="w-6 h-6" />
                    </div>
                    <div>
                        <h2 className="text-xl font-black text-slate-900" style={{ fontFamily: "'Fraunces', serif" }}>Price Bucket Performance</h2>
                        <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-0.5">Experience correlation by spending power</p>
                    </div>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead className="bg-slate-50/50">
                        <tr>
                            <th className="p-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Income/Price Group</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-900 uppercase tracking-widest bg-slate-100">Overall</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">Calls</th>
                            <th className="p-6 text-center text-[10px] font-bold text-rose-500 uppercase tracking-widest bg-rose-50/30">Bad Calls</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">Avg NPS (A)</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">Avg NPS (B)</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest border-l border-slate-100">R</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest">E</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest">L</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest">A</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest">X</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {Object.values(metrics.priceMap).sort((a,b) => b.calls - a.calls).map(b => {
                            const scale = (val) => (val * 3.33);
                            const avgA = (b.sumAgent / b.countNps).toFixed(1);
                            const avgB = (b.sumBrand / b.countNps).toFixed(1);
                            const avgR = (b.r / b.calls).toFixed(1);
                            const avgE = (b.e / b.calls).toFixed(1);
                            const avgL = (b.l / b.calls).toFixed(1);
                            const avgA_R = (b.a / b.calls).toFixed(1);
                            const avgX = (b.x / b.calls).toFixed(1);
                            const overall = ((scale(Number(avgR)) + scale(Number(avgE)) + scale(Number(avgL)) + scale(Number(avgA_R)) + scale(Number(avgX))) / 5).toFixed(1);

                            return (
                                <tr key={b.bucket} className="group hover:bg-slate-50 transition-all">
                                    <td className="p-6">
                                        <div className="font-black text-slate-900 uppercase tracking-tight">{b.bucket}</div>
                                        <div className="text-[10px] text-emerald-600 font-bold uppercase tracking-widest">Segment Data</div>
                                    </td>
                                    <td className="p-6 text-center bg-slate-100/30">
                                        <span className={`inline-block px-3 py-1 rounded-xl font-black text-sm border ${getScoreClass(overall)}`}>
                                            {overall}
                                        </span>
                                    </td>
                                    <td className="p-6 text-center font-bold text-slate-600">{b.calls}</td>
                                    <td className="p-6 text-center font-black text-rose-500 bg-rose-50/20">{b.badCalls}</td>
                                    <td className="p-6 text-center font-bold text-slate-900">{avgA}</td>
                                    <td className="p-6 text-center font-bold text-slate-900">{avgB}</td>
                                    <td className="p-6 text-center text-slate-500 border-l border-slate-50">{avgR}</td>
                                    <td className="p-6 text-center text-slate-500">{avgE}</td>
                                    <td className="p-6 text-center text-slate-500">{avgL}</td>
                                    <td className="p-6 text-center text-slate-500">{avgA_R}</td>
                                    <td className="p-6 text-center text-slate-500">{avgX}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>

      </div>
    </div>
  );
}

/* --- Sub Components --- */

function FilterSelect({ label, value, onChange, options }) {
    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest px-1">{label}</span>
            <select 
              value={value} 
              onChange={e => onChange(e.target.value)}
              className="bg-slate-50 border border-slate-100 text-xs font-bold text-slate-700 px-4 py-2.5 rounded-xl appearance-none cursor-pointer hover:bg-white focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500/30 transition-all outline-none"
              style={{
                backgroundImage: "url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%2364748b' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e\")",
                backgroundPosition: 'right 0.75rem center',
                backgroundRepeat: 'no-repeat',
                backgroundSize: '1.25em 1.25em',
                paddingRight: '2.5rem'
              }}
            >
                {options.map(o => <option key={o} value={o}>{o === 'All' ? `ALL ${label.toUpperCase()}S` : o}</option>)}
            </select>
        </div>
    );
}

function KpiCard({ label, value, subtitle, color, icon }) {
    const colors = {
        indigo: 'text-indigo-600 bg-indigo-50 border-indigo-100 shadow-indigo-200/20',
        emerald: 'text-emerald-600 bg-emerald-50 border-emerald-100 shadow-emerald-200/20',
        rose: 'text-rose-600 bg-rose-50 border-rose-100 shadow-rose-200/20'
    };
    const progressColors = {
        indigo: 'bg-indigo-600',
        emerald: 'bg-emerald-600',
        rose: 'bg-rose-600'
    };
    
    return (
        <div className={`bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-200/40 hover:-translate-y-1 transition-all duration-300 relative overflow-hidden group`}>
            {/* Background Glow */}
            <div className={`absolute -right-4 -top-4 w-24 h-24 rounded-full opacity-10 blur-2xl ${progressColors[color]}`}></div>
            
            <div className="flex justify-between items-start mb-6">
                <div className={`p-4 rounded-2xl ${colors[color]} border shadow-lg`}>
                    {React.cloneElement(icon, { size: 24 })}
                </div>
            </div>
            
            <div className="flex flex-col gap-1">
                <span className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">{label}</span>
                <span className="text-5xl font-black text-slate-900 tracking-tighter" style={{ fontFamily: "'Fraunces', serif" }}>
                    {value}
                </span>
                <span className="text-xs text-slate-400 font-medium">{subtitle}</span>
            </div>
            
            <div className="mt-6 h-1 w-full bg-slate-50 rounded-full overflow-hidden">
                <div className={`h-full ${progressColors[color]} rounded-full transition-all duration-1000 w-[70%]`}></div>
            </div>
        </div>
    );
}

function MatrixCell({ count, color, onClick }) {
    return (
        <button 
          onClick={onClick}
          className={`${color} rounded-3xl flex flex-col items-center justify-center min-h-[140px] text-white transition-all hover:-translate-y-1.5 hover:shadow-2xl hover:brightness-110 active:scale-95 group relative overflow-hidden`}
        >
            <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <span className="text-5xl font-black tracking-tighter mb-1">{count}</span>
            <span className="text-[10px] font-black uppercase tracking-[0.2em] opacity-70 group-hover:opacity-100 transition-opacity">Reports</span>
        </button>
    );
}

function getScoreClass(score) {
    const s = Number(score);
    if (s >= 7) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (s >= 5) return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-rose-50 text-rose-700 border-rose-200';
}
