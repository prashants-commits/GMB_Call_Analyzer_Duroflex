import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { fetchCalls, formatDuration, intentDotColor, formatShortDate, parseDate, isConverted, npsBucket } from '../utils/api';
import { Users, Target, DollarSign, Activity } from 'lucide-react';
import ScoreBadge from '../components/ScoreBadge';
import cityStoreMapping from '../utils/city_store_mapping.json';

export default function CallListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState({ calls: [], filters: { stores: [], cities: [] } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filter state
  const [search, setSearch] = useState('');
  const [storeFilter, setStoreFilter] = useState([]);
  const [intentFilter, setIntentFilter] = useState([]);
  const [expFilter, setExpFilter] = useState([]);
  const [funnelFilter, setFunnelFilter] = useState([]);
  const [cityFilter, setCityFilter] = useState([]);
  const [priceFilter, setPriceFilter] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState([]);
  const [barrierFilter, setBarrierFilter] = useState([]);
  const [callTypeFilter, setCallTypeFilter] = useState([]);
  const [visitFilter, setVisitFilter] = useState([]);
  const [npsAgentFilter, setNpsAgentFilter] = useState([]);
  const [npsBrandFilter, setNpsBrandFilter] = useState([]);
  const [convertedFilter, setConvertedFilter] = useState([]);
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

    // Handle incoming filters from dashboard. Normalize any string -> array
    // so downstream `.length` / `.includes()` and city↔store validation behave correctly.
    if (location.state) {
        const toArray = (v) => (Array.isArray(v) ? v : v != null ? [v] : []);
        if (location.state.intentFilter)    setIntentFilter(toArray(location.state.intentFilter));
        if (location.state.expFilter)       setExpFilter(toArray(location.state.expFilter));
        if (location.state.storeFilter)     setStoreFilter(toArray(location.state.storeFilter));
        if (location.state.cityFilter)      setCityFilter(toArray(location.state.cityFilter));
        if (location.state.priceFilter)     setPriceFilter(toArray(location.state.priceFilter));
        if (location.state.categoryFilter)  setCategoryFilter(toArray(location.state.categoryFilter));
        if (location.state.barrierFilter)   setBarrierFilter(toArray(location.state.barrierFilter));
        if (location.state.funnelFilter)    setFunnelFilter(toArray(location.state.funnelFilter));
        if (location.state.callTypeFilter)  setCallTypeFilter(toArray(location.state.callTypeFilter));
        if (location.state.visitFilter)     setVisitFilter(toArray(location.state.visitFilter));
        if (location.state.npsAgentFilter)  setNpsAgentFilter(toArray(location.state.npsAgentFilter));
        if (location.state.npsBrandFilter)  setNpsBrandFilter(toArray(location.state.npsBrandFilter));
        if (location.state.convertedFilter) setConvertedFilter(toArray(location.state.convertedFilter));
        if (location.state.startDate) setStartDate(location.state.startDate);
        if (location.state.endDate)   setEndDate(location.state.endDate);
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
    if (storeFilter.length > 0) result = result.filter(c => storeFilter.includes(c.store_name));
    if (intentFilter.length > 0) result = result.filter(c => intentFilter.includes(c.intent_rating));
    if (expFilter.length > 0) result = result.filter(c => expFilter.includes(c.experience_rating));
    if (funnelFilter.length > 0) result = result.filter(c => funnelFilter.includes(c.funnel_stage));
    if (cityFilter.length > 0) result = result.filter(c => cityFilter.includes(c.city));
    if (priceFilter.length > 0) result = result.filter(c => priceFilter.includes(c.price_bucket));
    if (categoryFilter.length > 0) result = result.filter(c => categoryFilter.includes(c.product_category));
    if (barrierFilter.length > 0) result = result.filter(c => barrierFilter.includes(c.purchase_barrier));
    if (callTypeFilter.length > 0) result = result.filter(c => callTypeFilter.includes(c.call_type));
    if (visitFilter.length > 0) result = result.filter(c => visitFilter.includes(c.visit_rating));
    if (npsAgentFilter.length > 0) result = result.filter(c => npsAgentFilter.includes(npsBucket(c.nps_agent)));
    if (npsBrandFilter.length > 0) result = result.filter(c => npsBrandFilter.includes(npsBucket(c.nps_brand)));
    if (convertedFilter.length > 0) {
        result = result.filter(c => {
            const conv = isConverted(c);
            if (convertedFilter.includes('YES') && conv) return true;
            if (convertedFilter.includes('NO') && !conv) return true;
            return false;
        });
    }

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
  }, [data.calls, search, storeFilter, intentFilter, expFilter, funnelFilter, cityFilter, priceFilter, categoryFilter, barrierFilter, callTypeFilter, visitFilter, npsAgentFilter, npsBrandFilter, convertedFilter, startDate, endDate]);

  // KPIs
  const kpis = useMemo(() => {
    const total = filteredCalls.length;
    
    let convertedCount = 0;
    let totalRevenue = 0;

    filteredCalls.forEach(r => {
        if (isConverted(r)) {
            convertedCount++;
        }
        
        let rev = 0;
        if (r.revenue) {
            rev = parseFloat(String(r.revenue).replace(/[^0-9.-]+/g, "")) || 0;
        }
        totalRevenue += rev;
    });

    const conversionPercent = total > 0 ? ((convertedCount / total) * 100).toFixed(1) : "0.0";
    const revPerLead = total > 0 ? (totalRevenue / total) : 0;
    const arpu = convertedCount > 0 ? (totalRevenue / convertedCount) : 0;

    const formatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
    const totalRevenueFormatted = formatter.format(totalRevenue);
    const revPerLeadFormatted = formatter.format(revPerLead);
    const arpuFormatted = formatter.format(arpu);

    return { 
        total, 
        salesLeads: total, 
        convertedCount,
        totalRevenue,
        conversionPercent,
        totalRevenueFormatted,
        revPerLeadFormatted,
        arpuFormatted 
    };
  }, [filteredCalls]);

  // Unique funnel stages for filter
  const funnelStages = useMemo(() => {
    const stages = [...new Set((data.calls || []).map(c => c.funnel_stage).filter(Boolean))];
    return ['All', ...stages.sort()];
  }, [data.calls]);

  const citiesList = useMemo(() => ['All', ...new Set((data.calls || []).map(c => c.city).filter(Boolean).sort())], [data.calls]);
  const pricesList = useMemo(() => ['All', ...new Set((data.calls || []).map(c => c.price_bucket).filter(Boolean).sort())], [data.calls]);
  const categoriesList = useMemo(() => ['All', ...new Set((data.calls || []).map(c => c.product_category).filter(Boolean).sort())], [data.calls]);
  const barriersList = useMemo(() => ['All', ...new Set((data.calls || []).map(c => c.purchase_barrier).filter(Boolean).sort())], [data.calls]);
  const callTypesList = useMemo(() => ['All', ...new Set((data.calls || []).map(c => c.call_type).filter(Boolean).sort())], [data.calls]);

  const availableStores = useMemo(() => {
    if (cityFilter.length === 0) {
      return data.filters?.stores || [];
    }
    let stores = [];
    cityFilter.forEach(city => {
        if (cityStoreMapping[city]) {
            stores = stores.concat(cityStoreMapping[city]);
        }
    });
    return [...new Set(stores)].sort();
  }, [cityFilter, data.filters?.stores]);

  useEffect(() => {
      if (cityFilter.length > 0 && storeFilter.length > 0) {
          const validStores = storeFilter.filter(s => availableStores.includes(s));
          if (validStores.length !== storeFilter.length) {
              setStoreFilter(validStores);
          }
      }
  }, [availableStores, cityFilter, storeFilter]);

  const resetFilters = () => {
    setSearch(''); setStoreFilter([]); setIntentFilter([]); setExpFilter([]); setFunnelFilter([]);
    setCityFilter([]); setPriceFilter([]); setCategoryFilter([]); setBarrierFilter([]);
    setCallTypeFilter([]); setVisitFilter([]); setNpsAgentFilter([]); setNpsBrandFilter([]);
    setConvertedFilter([]);
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
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 mb-10">
            <KpiCard 
              label="Total Sales Calls" 
              value={kpis.salesLeads} 
              subtitle="All Calls that specifically had Sales Intent, excluding all Post Purchase Calls" 
              color="indigo" 
              icon={<Users />} 
            />
            <KpiCard 
              label="Revenue per Lead" 
              value={kpis.revPerLeadFormatted} 
              subtitle="Total Revenue received against all Sales leads" 
              color="emerald" 
              icon={<DollarSign />} 
            />
            <KpiCard 
              label="Conversion %" 
              value={`${kpis.conversionPercent}%`} 
              subtitle="What % of Sales Leads placed Ordered" 
              color="emerald" 
              icon={<Target />} 
            />
            <KpiCard 
              label="Total Revenue" 
              value={kpis.totalRevenueFormatted} 
              subtitle="What is the total Received Revenue against all Sales leads" 
              color="indigo" 
              icon={<DollarSign />} 
            />
            <KpiCard 
              label="ARPU" 
              value={kpis.arpuFormatted} 
              subtitle="Avg Revenue per Converted lead" 
              color="emerald" 
              icon={<Activity />} 
            />
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
              <FilterSelect value={cityFilter} onChange={setCityFilter}
                options={citiesList} prefix="City" />

              <FilterSelect value={storeFilter} onChange={setStoreFilter}
                options={['All', ...availableStores]} prefix="Store" />

              <FilterSelect value={callTypeFilter} onChange={setCallTypeFilter}
                options={callTypesList} prefix="Call Type" />

              <FilterSelect value={intentFilter} onChange={setIntentFilter}
                options={['All', 'HIGH', 'MEDIUM', 'LOW']} prefix="Intent" />

              <FilterSelect value={visitFilter} onChange={setVisitFilter}
                options={['All', 'HIGH', 'MEDIUM', 'LOW']} prefix="Visit" />

              <FilterSelect value={expFilter} onChange={setExpFilter}
                options={['All', 'HIGH', 'MEDIUM', 'LOW']} prefix="Exp" />

              <FilterSelect value={npsAgentFilter} onChange={setNpsAgentFilter}
                options={['All', 'HIGH', 'MEDIUM', 'LOW']} prefix="Agent NPS" />

              <FilterSelect value={npsBrandFilter} onChange={setNpsBrandFilter}
                options={['All', 'HIGH', 'MEDIUM', 'LOW']} prefix="Brand NPS" />

              <FilterSelect value={categoryFilter} onChange={setCategoryFilter}
                options={categoriesList} prefix="Category" />

              <FilterSelect value={funnelFilter} onChange={setFunnelFilter}
                options={funnelStages} prefix="Funnel" />

              <FilterSelect value={priceFilter} onChange={setPriceFilter}
                options={pricesList} prefix="Price" />

              <FilterSelect value={barrierFilter} onChange={setBarrierFilter}
                options={barriersList} prefix="Barrier" />

              <FilterSelect value={convertedFilter} onChange={setConvertedFilter}
                options={['All', 'YES', 'NO']} prefix="Converted" />

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
        <div className={`bg-white p-8 rounded-[2.5rem] border border-gray-200 shadow-xl shadow-gray-200/40 hover:-translate-y-1 transition-all duration-300 relative overflow-hidden group`}>
            {/* Background Glow */}
            <div className={`absolute -right-4 -top-4 w-24 h-24 rounded-full opacity-10 blur-2xl ${progressColors[color]}`}></div>
            
            <div className="flex justify-between items-start mb-6">
                <div className={`p-4 rounded-2xl ${colors[color]} border shadow-lg`}>
                    {React.cloneElement(icon, { size: 24 })}
                </div>
            </div>
            
            <div className="flex flex-col gap-1">
                <span className="text-[11px] font-black text-gray-400 uppercase tracking-[0.2em]">{label}</span>
                <span className="text-4xl font-black text-gray-900 tracking-tighter" style={{ fontFamily: "'Fraunces', serif" }}>
                    {value}
                </span>
                <span className="text-[11px] text-gray-400 font-medium leading-snug mt-1">{subtitle}</span>
            </div>
            
            <div className="mt-6 h-1 w-full bg-gray-50 rounded-full overflow-hidden">
                <div className={`h-full ${progressColors[color]} rounded-full transition-all duration-1000 w-[70%]`}></div>
            </div>
        </div>
    );
}

function FilterSelect({ value, onChange, options, prefix }) {
  const [isOpen, setIsOpen] = useState(false);
  
  const toggleOption = (opt) => {
      if (value.includes(opt)) {
          onChange(value.filter(v => v !== opt));
      } else {
          onChange([...value, opt]);
      }
  };
  
  const displayCount = value.length === 0 ? 'ALL' : `${value.length} Sel`;

  return (
    <div className="relative group">
        <button 
            onClick={() => setIsOpen(!isOpen)}
            className="bg-gray-100 border-none text-gray-700 text-[11px] font-bold uppercase tracking-widest px-4 py-2.5 flex items-center justify-between gap-3 min-w-[140px] rounded-xl hover:bg-gray-200 focus:ring-2 focus:ring-blue-500/20 transition-all outline-none"
        >
            <span>{prefix}: {displayCount}</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        
        {isOpen && (
            <>
                <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)}></div>
                <div className="absolute top-full left-0 mt-2 w-56 bg-white border border-gray-100 shadow-2xl rounded-2xl z-50 py-2 max-h-64 overflow-y-auto overflow-x-hidden">
                    {options.map(o => {
                        if (o === 'All') return null;
                        const isSelected = value.includes(o);
                        return (
                            <button 
                                key={o} 
                                onClick={() => toggleOption(o)}
                                className="w-full text-left px-4 py-2 hover:bg-blue-50 flex items-center gap-3 transition-colors"
                            >
                                <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${isSelected ? 'bg-blue-600 border-blue-600' : 'bg-gray-50 border-gray-200'}`}>
                                    {isSelected && <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>}
                                </div>
                                <span className={`text-xs font-bold leading-tight ${isSelected ? 'text-gray-900' : 'text-gray-500'} break-words whitespace-normal`}>{o}</span>
                            </button>
                        );
                    })}
                    {options.length <= 1 && (
                        <div className="px-4 py-2 text-xs text-gray-400 font-bold uppercase tracking-widest text-center">No Data</div>
                    )}
                </div>
            </>
        )}
    </div>
  );
}
