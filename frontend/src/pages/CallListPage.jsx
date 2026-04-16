import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { fetchCalls, formatDuration, intentDotColor, formatShortDate, parseDate } from '../utils/api';
import ScoreBadge from '../components/ScoreBadge';

export default function CallListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState({ calls: [], filters: { stores: [], cities: [] } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filter state
  const [search, setSearch] = useState('');
  const [storeFilter, setStoreFilter] = useState('All');
  const [intentFilter, setIntentFilter] = useState('All');
  const [expFilter, setExpFilter] = useState('All');
  const [funnelFilter, setFunnelFilter] = useState('All');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    fetchCalls()
      .then(setData)
      .catch((err) => {
          console.error(err);
          setError('Failed to load calls from server');
      })
      .finally(() => setLoading(false));

    // Handle incoming filters from dashboard
    if (location.state) {
        if (location.state.intentFilter) setIntentFilter(location.state.intentFilter);
        if (location.state.expFilter) setExpFilter(location.state.expFilter);
        if (location.state.storeFilter) setStoreFilter(location.state.storeFilter);
        if (location.state.startDate) setStartDate(location.state.startDate);
        if (location.state.endDate) setEndDate(location.state.endDate);
    }
  }, [location.state]);

  const filteredCalls = useMemo(() => {
    let result = data.calls || [];

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(c =>
        c.clean_number?.toLowerCase().includes(q) ||
        c.store_name?.toLowerCase().includes(q) ||
        c.customer_name?.toLowerCase().includes(q) ||
        c.city?.toLowerCase().includes(q)
      );
    }
    if (storeFilter !== 'All') result = result.filter(c => c.store_name === storeFilter);
    if (intentFilter !== 'All') result = result.filter(c => c.intent_rating === intentFilter);
    if (expFilter !== 'All') result = result.filter(c => c.experience_rating === expFilter);
    if (funnelFilter !== 'All') result = result.filter(c => c.funnel_stage === funnelFilter);

    if (startDate || endDate) {
        result = result.filter(c => {
            const d = parseDate(c.call_date);
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
  }, [data.calls, search, storeFilter, intentFilter, expFilter, funnelFilter, startDate, endDate]);

  // KPIs
  const kpis = useMemo(() => {
    const total = filteredCalls.length;
    const highIntent = filteredCalls.filter(c => c.intent_rating === 'HIGH').length;
    const salesLeads = filteredCalls.filter(c => (c.call_objective || '').toLowerCase().includes('sales')).length;
    const converted = filteredCalls.filter(c => c.is_converted === '1' || c.is_converted === 1).length;
    return { 
        total, 
        highIntentPct: total > 0 ? Math.round((highIntent / total) * 100) : 0, 
        salesLeads, 
        converted,
        conversionRate: total > 0 ? ((converted / total) * 100).toFixed(1) : '0'
    };
  }, [filteredCalls]);

  // Unique funnel stages for filter
  const funnelStages = useMemo(() => {
    const stages = [...new Set((data.calls || []).map(c => c.funnel_stage).filter(Boolean))];
    return ['All', ...stages.sort()];
  }, [data.calls]);

  const resetFilters = () => {
    setSearch(''); setStoreFilter('All'); setIntentFilter('All'); setExpFilter('All'); setFunnelFilter('All');
    setStartDate(''); setEndDate('');
  };

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-6">
      <div className="flex space-x-2">
          <div className="w-3 h-3 bg-blue-600 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
          <div className="w-3 h-3 bg-blue-600 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
          <div className="w-3 h-3 bg-blue-600 rounded-full animate-bounce"></div>
      </div>
      <div className="text-gray-400 font-bold uppercase tracking-widest text-xs animate-pulse">Loading GMB Intel...</div>
    </div>
  );
  if (error) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white p-10 rounded-3xl shadow-xl border border-red-100 flex flex-col items-center gap-4">
        <div className="bg-red-50 p-4 rounded-full">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <div className="text-red-600 text-xl font-bold">{error}</div>
        <button onClick={() => window.location.reload()} className="bg-red-600 text-white px-6 py-2 rounded-xl font-bold text-sm shadow-lg shadow-red-200 hover:bg-red-700 transition-all">Retry Connection</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 selection:bg-blue-100">
      <div className="max-w-[1700px] mx-auto px-6 md:px-10 py-10">

        {/* Header */}
        <div className="mb-10 flex justify-between items-end flex-wrap gap-6">
          <div className="border-l-4 border-blue-600 pl-6">
            <button 
              onClick={() => navigate('/')}
              className="text-[10px] font-bold text-blue-600 mb-2 flex items-center gap-1 hover:gap-2 transition-all uppercase tracking-widest"
            >
              ← Back to Dashboard
            </button>
            <h1 className="text-4xl font-bold text-gray-900 heading-font tracking-tight">GMB Inbound Calls</h1>
            <p className="text-sm text-gray-500 mt-2 font-medium">Real-time analysis of customer intent and store performance</p>
          </div>
          <div className="flex items-center gap-3">
              <span className="flex h-3 w-3 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              <span className="text-xs font-bold text-emerald-600 uppercase tracking-widest">Live Monitoring Active</span>
          </div>
        </div>

        {/* KPI Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
          <KpiCard label="Total Reports" value={kpis.total} color="blue" icon="📊" />
          <KpiCard label="High Intent" value={`${kpis.highIntentPct}%`} color="emerald" icon="🔥" />
          <KpiCard label="Sales Lead %" value={`${Math.round((kpis.salesLeads / (kpis.total || 1)) * 100)}%`} color="indigo" icon="🎯" />
          <KpiCard label="Conversion Rate" value={`${kpis.conversionRate}%`} color="amber" icon="💰" />
        </div>

        {/* Filter Strip */}
        <div className="bg-white p-5 rounded-3xl border-2 border-gray-100 shadow-xl shadow-gray-200/50 flex flex-wrap gap-5 items-center mb-10 group">
          <div className="bg-gray-100 p-2 rounded-xl text-gray-400 group-hover:text-blue-600 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </div>

          <input
            type="text"
            placeholder="Search store, number, name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-gray-50 border-none text-gray-700 text-sm font-semibold px-5 py-3 rounded-2xl focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all outline-none placeholder:text-gray-300"
          />

          <div className="flex flex-wrap gap-3">
              <FilterSelect value={storeFilter} onChange={setStoreFilter}
                options={['All', ...(data.filters?.stores || [])]} prefix="Store" />

              <FilterSelect value={intentFilter} onChange={setIntentFilter}
                options={['All', 'HIGH', 'MEDIUM', 'LOW']} prefix="Intent" />

              <FilterSelect value={expFilter} onChange={setExpFilter}
                options={['All', 'HIGH', 'MEDIUM', 'LOW']} prefix="Exp" />

              <FilterSelect value={funnelFilter} onChange={setFunnelFilter}
                options={funnelStages} prefix="Funnel" />

              <div className="flex items-center gap-2 bg-gray-50 px-4 py-2 rounded-2xl border border-gray-100 shadow-inner">
                  <div className="flex flex-col">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">From</span>
                      <input 
                        type="date" 
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="text-xs font-bold text-gray-700 bg-transparent focus:outline-none transition-all cursor-pointer"
                      />
                  </div>
                  <div className="flex flex-col border-l border-gray-200 pl-4 ml-1">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">To</span>
                      <input 
                        type="date" 
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="text-xs font-bold text-gray-700 bg-transparent focus:outline-none transition-all cursor-pointer"
                      />
                  </div>
              </div>
          </div>

          <div className="lg:border-l lg:pl-5 border-gray-100 flex items-center gap-4 ml-auto">
            <div className="text-right">
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest block">Matched</span>
                <span className="text-sm font-bold text-gray-900">{filteredCalls.length} <span className="text-gray-300">/</span> {(data.calls || []).length}</span>
            </div>
            <button onClick={resetFilters}
              className="p-2.5 bg-red-50 text-red-500 rounded-xl hover:bg-red-500 hover:text-white transition-all shadow-sm"
              title="Reset Filters">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white border-2 border-gray-100 rounded-[2rem] shadow-2xl shadow-gray-200/30 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50/80 border-b border-gray-100">
                  {['Call ID', 'Timestamp', 'Store Details', 'Duration', 'Customer', 'Performance', 'Funnel & Objective'].map(h => (
                    <th key={h} className="px-8 py-5 text-left text-[11px] font-bold text-gray-400 uppercase tracking-[0.15em] border-r border-gray-200/50 last:border-0">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredCalls.length === 0 ? (
                  <tr><td colSpan="7" className="px-8 py-20 text-center">
                      <div className="flex flex-col items-center gap-3">
                          <div className="text-gray-200">
                              <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                          </div>
                          <p className="text-gray-400 font-bold text-lg">No records match your criteria.</p>
                          <button onClick={resetFilters} className="text-blue-600 hover:underline font-bold text-sm">Clear all filters</button>
                      </div>
                  </td></tr>
                ) : (
                  filteredCalls.map((call, idx) => (
                    <tr key={call.clean_number}
                      onClick={() => navigate(`/call/${call.clean_number}`)}
                      className="group hover:bg-blue-50/50 transition-all cursor-pointer relative">
                      
                      <td className="px-8 py-5">
                        <div className="flex flex-col">
                            <span className="font-mono text-xs font-bold text-gray-500 bg-gray-100 px-2 py-1 rounded-md w-fit mb-1 border border-gray-200">
                              #{call.clean_number ? call.clean_number.slice(-8) : 'N/A'}
                            </span>
                            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{call.brand}</span>
                        </div>
                      </td>

                      <td className="px-8 py-5">
                        <div className="flex flex-col gap-1">
                            <span className="text-sm font-bold text-gray-900">{formatShortDate(call.call_date)}</span>
                            <span className="text-xs text-gray-400 font-medium">{call.call_date && call.call_date.includes(' ') ? call.call_date.split(' ')[1] : ''}</span>
                        </div>
                      </td>

                      <td className="px-8 py-5">
                        <div className="flex flex-col">
                            <div className="font-bold text-gray-900 text-sm group-hover:text-blue-700 transition-colors uppercase tracking-tight">{call.store_name || 'Unknown'}</div>
                            <div className="text-xs text-blue-500 font-bold">{call.city}{call.state ? `, ${call.state.slice(0, 3)}` : ''}</div>
                        </div>
                      </td>

                      <td className="px-8 py-5">
                        <div className="flex items-center gap-2">
                             <div className="h-1.5 w-1.5 rounded-full bg-blue-300"></div>
                             <span className="font-mono text-sm font-bold text-gray-600">{formatDuration(call.duration)}</span>
                        </div>
                      </td>

                      <td className="px-8 py-5">
                        <div className="flex flex-col">
                            <div className="text-sm font-bold text-gray-900">{call.customer_name || 'Anonymous User'}</div>
                            <div className="text-xs text-gray-400 font-mono tracking-tighter">{call.clean_number}</div>
                        </div>
                      </td>

                      <td className="px-8 py-5">
                        <div className="flex flex-col gap-2">
                           <div className="flex items-center justify-between gap-6">
                               <span className="text-[9px] font-bold text-gray-400 uppercase">Intent</span>
                               <div className="flex items-center gap-1.5 bg-white border border-gray-100 px-2.5 py-1 rounded-full shadow-sm">
                                   <span className={`h-2 w-2 rounded-full ${intentDotColor(call.intent_rating)}`}></span>
                                   <span className="font-bold text-gray-700 text-[10px]">{call.intent_rating}</span>
                               </div>
                           </div>
                           <div className="flex items-center justify-between gap-6">
                               <span className="text-[9px] font-bold text-gray-400 uppercase">Exp</span>
                               <ScoreBadge label={call.experience_rating} className="!text-[9px] !px-2 !py-0.5" />
                           </div>
                        </div>
                      </td>

                      <td className="px-8 py-5">
                        <div className="flex flex-col gap-1">
                            <div className="text-[10px] text-gray-900 font-bold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-lg border border-blue-100 w-fit">
                                {call.funnel_stage || 'N/A'}
                            </div>
                            <span className="text-xs text-gray-500 font-medium truncate max-w-[200px]" title={call.call_objective}>
                                {call.call_objective || 'N/A'}
                            </span>
                        </div>
                        {/* Action Reveal */}
                        <div className="absolute right-6 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-all translate-x-4 group-hover:translate-x-0">
                            <div className="bg-blue-600 p-2.5 rounded-2xl text-white shadow-xl shadow-blue-200">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                            </div>
                        </div>
                      </td>

                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="px-8 py-4 border-t border-gray-100 bg-gray-50/50 flex justify-between items-center">
             <div className="flex items-center gap-4">
                <p className="text-xs text-gray-500 font-medium">
                  Showing <span className="font-bold text-gray-900">{filteredCalls.length}</span> of <span className="font-bold text-gray-900">{data.calls.length}</span> reports
                </p>
             </div>
             <div className="flex gap-1">
                 {[1].map(p => (
                     <button key={p} className="h-8 w-8 rounded-lg bg-blue-600 text-white text-xs font-bold shadow-lg shadow-blue-200">1</button>
                 ))}
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function KpiCard({ label, value, color, icon }) {
  const bgMap = { 
      blue: 'bg-blue-50/50 text-blue-600 border-blue-100', 
      emerald: 'bg-emerald-50/50 text-emerald-600 border-emerald-100', 
      indigo: 'bg-indigo-50/50 text-indigo-600 border-indigo-100', 
      amber: 'bg-amber-50/50 text-amber-600 border-amber-100' 
  };
  const iconBgMap = {
      blue: 'bg-blue-600',
      emerald: 'bg-emerald-600',
      indigo: 'bg-indigo-600',
      amber: 'bg-amber-600'
  };
  return (
    <div className={`bg-white p-6 rounded-[2rem] border-2 shadow-sm transition-all hover:translate-y-[-4px] hover:shadow-xl hover:shadow-${color}-100 flex flex-col gap-4 ${bgMap[color] || 'border-gray-100'}`}>
      <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em]">{label}</span>
          <span className="text-xl">{icon}</span>
      </div>
      <p className="text-3xl font-bold text-gray-900 heading-font">{value}</p>
      <div className="h-1.5 w-12 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full ${iconBgMap[color] || 'bg-gray-400'} rounded-full`} style={{ width: '65%' }}></div>
      </div>
    </div>
  );
}

function FilterSelect({ value, onChange, options, prefix }) {
  return (
    <div className="relative group">
        <select value={value} onChange={e => onChange(e.target.value)}
          className="bg-gray-100 border-none text-gray-700 text-[11px] font-bold uppercase tracking-widest px-4 py-2.5 pr-10 rounded-xl appearance-none cursor-pointer hover:bg-gray-200 focus:ring-2 focus:ring-blue-500/20 transition-all outline-none"
          style={{
            backgroundImage: "url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e\")",
            backgroundPosition: 'right 0.75rem center',
            backgroundRepeat: 'no-repeat',
            backgroundSize: '1.25em 1.25em',
          }}>
          {options.map(o => (
            <option key={o} value={o}>{o === 'All' ? `${prefix}: ALL` : o}</option>
          ))}
        </select>
    </div>
  );
}
