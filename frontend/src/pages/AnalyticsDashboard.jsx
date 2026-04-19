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
  TrendingUp,
  Activity,
  DollarSign,
  Download,
  Sparkles
} from 'lucide-react';
import { fetchAnalyticsData, parseDate } from '../utils/api';
import cityStoreMapping from '../utils/city_store_mapping.json';

export default function AnalyticsDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState({ reports: [], filters: { stores: [], product_categories: [] } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Local Filters
  const [cityFilter, setCityFilter] = useState([]);
  const [storeFilter, setStoreFilter] = useState([]);
  const [callTypeFilter, setCallTypeFilter] = useState([]);
  const [intentFilter, setIntentFilter] = useState([]);
  const [visitFilter, setVisitFilter] = useState([]);
  const [npsAgentFilter, setNpsAgentFilter] = useState([]);
  const [npsBrandFilter, setNpsBrandFilter] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState([]);
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

  const availableStores = useMemo(() => {
    if (cityFilter.length === 0) return data.filters.stores || [];
    let stores = [];
    cityFilter.forEach(city => {
        if (cityStoreMapping[city]) {
            stores = stores.concat(cityStoreMapping[city]);
        }
    });
    return [...new Set(stores)].sort();
  }, [cityFilter, data.filters.stores]);

  useEffect(() => {
    if (cityFilter.length > 0 && storeFilter.length > 0) {
        const validStores = storeFilter.filter(s => availableStores.includes(s));
        if (validStores.length !== storeFilter.length) {
            setStoreFilter(validStores);
        }
    }
  }, [availableStores, cityFilter, storeFilter]);

  const filteredCalls = useMemo(() => {
    let result = data.reports || [];

    if (cityFilter.length > 0) result = result.filter(r => cityFilter.includes(r.city));
    if (storeFilter.length > 0) result = result.filter(r => storeFilter.includes(r.store_name));
    if (callTypeFilter.length > 0) result = result.filter(r => callTypeFilter.includes(r.call_type));
    if (intentFilter.length > 0) result = result.filter(r => intentFilter.includes(r.intent_rating));
    if (visitFilter.length > 0) result = result.filter(r => visitFilter.includes(r.visit_rating));
    if (categoryFilter.length > 0) result = result.filter(r => categoryFilter.includes(r.product_category));
    
    if (npsAgentFilter.length > 0) {
        result = result.filter(r => {
            const isHigh = r.nps_agent >= 8;
            const isMedium = r.nps_agent >= 5 && r.nps_agent < 8;
            const isLow = r.nps_agent < 5;
            if (npsAgentFilter.includes('HIGH') && isHigh) return true;
            if (npsAgentFilter.includes('MEDIUM') && isMedium) return true;
            if (npsAgentFilter.includes('LOW') && isLow) return true;
            return false;
        });
    }

    if (npsBrandFilter.length > 0) {
        result = result.filter(r => {
            const isHigh = r.nps_brand >= 8;
            const isMedium = r.nps_brand >= 5 && r.nps_brand < 8;
            const isLow = r.nps_brand < 5;
            if (npsBrandFilter.includes('HIGH') && isHigh) return true;
            if (npsBrandFilter.includes('MEDIUM') && isMedium) return true;
            if (npsBrandFilter.includes('LOW') && isLow) return true;
            return false;
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
  }, [data.reports, cityFilter, storeFilter, callTypeFilter, intentFilter, visitFilter, npsAgentFilter, npsBrandFilter, categoryFilter, startDate, endDate]);

  const metrics = useMemo(() => {
    const total = filteredCalls.length;
    
    let convertedCount = 0;
    let totalRevenue = 0;

    filteredCalls.forEach(r => {
        if (String(r.is_converted) === "1" || String(r.is_converted).toLowerCase() === "true" || String(r.is_converted).toLowerCase() === "yes") {
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

    let sumAgentNps = 0;
    let sumBrandNps = 0;
    let storeInvCount = 0;
    let waCount = 0;
    let videoCount = 0;
    let probingWhyCount = 0;
    let probingWhomCount = 0;

    filteredCalls.forEach(r => {
        sumAgentNps += r.nps_agent || 0;
        sumBrandNps += r.nps_brand || 0;
        if (String(r.store_invitation).toLowerCase() === 'yes') storeInvCount++;
        if (String(r.wa_connection).toLowerCase() === 'yes') waCount++;
        if (String(r.video_demo).toLowerCase() === 'yes') videoCount++;
        if (String(r.probing_why).toLowerCase() === 'yes') probingWhyCount++;
        if (String(r.probing_whom).toLowerCase() === 'yes') probingWhomCount++;
    });

    const avgNpsAgent = total > 0 ? Math.round((sumAgentNps / total) * 10) + "%" : "0%";
    const avgNpsBrand = total > 0 ? Math.round((sumBrandNps / total) * 10) + "%" : "0%";
    const waConnectionPerc = total > 0 ? ((waCount / total) * 100).toFixed(0) : "0";
    const storeInvitationPerc = total > 0 ? ((storeInvCount / total) * 100).toFixed(0) : "0";
    const probingWhyPerc = total > 0 ? ((probingWhyCount / total) * 100).toFixed(0) : "0";
    const probingWhomPerc = total > 0 ? ((probingWhomCount / total) * 100).toFixed(0) : "0";
    const videoDemoPerc = total > 0 ? ((videoCount / total) * 100).toFixed(0) : "0";

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

    // City Performance
    const cityMap = {};
    filteredCalls.forEach(r => {
        const city = r.city || 'Unknown';
        if (!cityMap[city]) {
            cityMap[city] = { 
                city: city, calls: 0, badCalls: 0, 
                sumAgent: 0, sumBrand: 0, countNps: 0,
                convertedCount: 0, totalRevenue: 0,
                storeInvCount: 0, waCount: 0, videoCount: 0, probingWhyCount: 0, proactiveCount: 0
            };
        }
        const c = cityMap[city];
        c.calls++;
        if (r.intent_rating === 'HIGH' && r.experience_rating !== 'HIGH') c.badCalls++;
        c.sumAgent += r.nps_agent;
        c.sumBrand += r.nps_brand;
        c.countNps++;

        if (String(r.is_converted) === "1" || String(r.is_converted).toLowerCase() === "true" || String(r.is_converted).toLowerCase() === "yes") {
            c.convertedCount++;
        }
        let rev = 0;
        if (r.revenue) rev = parseFloat(String(r.revenue).replace(/[^0-9.-]+/g, "")) || 0;
        c.totalRevenue += rev;
        
        if (String(r.store_invitation).toLowerCase() === 'yes') c.storeInvCount++;
        if (String(r.wa_connection).toLowerCase() === 'yes') c.waCount++;
        if (String(r.video_demo).toLowerCase() === 'yes') c.videoCount++;
        if (String(r.probing_why).toLowerCase() === 'yes') c.probingWhyCount++;
        if (String(r.proactive).toLowerCase() === 'proactive') c.proactiveCount++;
    });

    // Store Performance
    const storeMap = {};
    filteredCalls.forEach(r => {
        if (!storeMap[r.store_name]) {
            storeMap[r.store_name] = { 
                name: r.store_name, city: r.city, calls: 0, badCalls: 0, 
                sumAgent: 0, sumBrand: 0, countNps: 0,
                r: 0, e: 0, l: 0, a: 0, x: 0,
                convertedCount: 0, totalRevenue: 0,
                storeInvCount: 0, waCount: 0, videoCount: 0, probingWhyCount: 0, proactiveCount: 0
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

        if (String(r.is_converted) === "1" || String(r.is_converted).toLowerCase() === "true" || String(r.is_converted).toLowerCase() === "yes") {
            s.convertedCount++;
        }
        let rev = 0;
        if (r.revenue) rev = parseFloat(String(r.revenue).replace(/[^0-9.-]+/g, "")) || 0;
        s.totalRevenue += rev;
        
        if (String(r.store_invitation).toLowerCase() === 'yes') s.storeInvCount++;
        if (String(r.wa_connection).toLowerCase() === 'yes') s.waCount++;
        if (String(r.video_demo).toLowerCase() === 'yes') s.videoCount++;
        if (String(r.probing_why).toLowerCase() === 'yes') s.probingWhyCount++;
        if (String(r.proactive).toLowerCase() === 'proactive') s.proactiveCount++;
    });

    // Price Bucket Performance
    const priceMap = {};
    filteredCalls.forEach(r => {
        const bucket = r.price_bucket || 'Unknown';
        if (!priceMap[bucket]) {
            priceMap[bucket] = { 
                bucket, calls: 0, badCalls: 0, 
                sumAgent: 0, sumBrand: 0, countNps: 0,
                convertedCount: 0, totalRevenue: 0,
                storeInvCount: 0, waCount: 0, videoCount: 0, probingWhyCount: 0, proactiveCount: 0
            };
        }
        const b = priceMap[bucket];
        b.calls++;
        if (r.intent_rating === 'HIGH' && r.experience_rating !== 'HIGH') b.badCalls++;
        b.sumAgent += r.nps_agent;
        b.sumBrand += r.nps_brand;
        b.countNps++;

        if (String(r.is_converted) === "1" || String(r.is_converted).toLowerCase() === "true" || String(r.is_converted).toLowerCase() === "yes") {
            b.convertedCount++;
        }
        let rev = 0;
        if (r.revenue) rev = parseFloat(String(r.revenue).replace(/[^0-9.-]+/g, "")) || 0;
        b.totalRevenue += rev;
        
        if (String(r.store_invitation).toLowerCase() === 'yes') b.storeInvCount++;
        if (String(r.wa_connection).toLowerCase() === 'yes') b.waCount++;
        if (String(r.video_demo).toLowerCase() === 'yes') b.videoCount++;
        if (String(r.probing_why).toLowerCase() === 'yes') b.probingWhyCount++;
        if (String(r.proactive).toLowerCase() === 'proactive') b.proactiveCount++;
    });

    // Product Category Performance
    const categoryMap = {};
    filteredCalls.forEach(r => {
        const cat = r.product_category || 'Unknown';
        if (!categoryMap[cat]) {
            categoryMap[cat] = { 
                category: cat, calls: 0, badCalls: 0, 
                sumAgent: 0, sumBrand: 0, countNps: 0,
                convertedCount: 0, totalRevenue: 0,
                storeInvCount: 0, waCount: 0, videoCount: 0, probingWhyCount: 0, proactiveCount: 0
            };
        }
        const c = categoryMap[cat];
        c.calls++;
        if (r.intent_rating === 'HIGH' && r.experience_rating !== 'HIGH') c.badCalls++;
        c.sumAgent += r.nps_agent;
        c.sumBrand += r.nps_brand;
        c.countNps++;

        if (String(r.is_converted) === "1" || String(r.is_converted).toLowerCase() === "true" || String(r.is_converted).toLowerCase() === "yes") {
            c.convertedCount++;
        }
        let rev = 0;
        if (r.revenue) rev = parseFloat(String(r.revenue).replace(/[^0-9.-]+/g, "")) || 0;
        c.totalRevenue += rev;
        
        if (String(r.store_invitation).toLowerCase() === 'yes') c.storeInvCount++;
        if (String(r.wa_connection).toLowerCase() === 'yes') c.waCount++;
        if (String(r.video_demo).toLowerCase() === 'yes') c.videoCount++;
        if (String(r.probing_why).toLowerCase() === 'yes') c.probingWhyCount++;
        if (String(r.proactive).toLowerCase() === 'proactive') c.proactiveCount++;
    });

    // Purchase Barrier Performance
    const barrierMap = {};
    filteredCalls.forEach(r => {
        const barrier = r.purchase_barrier || 'Unknown';
        if (!barrierMap[barrier]) {
            barrierMap[barrier] = { 
                barrier: barrier, calls: 0, badCalls: 0, 
                sumAgent: 0, sumBrand: 0, countNps: 0,
                convertedCount: 0, totalRevenue: 0,
                storeInvCount: 0, waCount: 0, videoCount: 0, probingWhyCount: 0, proactiveCount: 0
            };
        }
        const a = barrierMap[barrier];
        a.calls++;
        if (r.intent_rating === 'HIGH' && r.experience_rating !== 'HIGH') a.badCalls++;
        a.sumAgent += r.nps_agent;
        a.sumBrand += r.nps_brand;
        a.countNps++;

        if (String(r.is_converted) === "1" || String(r.is_converted).toLowerCase() === "true" || String(r.is_converted).toLowerCase() === "yes") {
            a.convertedCount++;
        }
        let rev = 0;
        if (r.revenue) rev = parseFloat(String(r.revenue).replace(/[^0-9.-]+/g, "")) || 0;
        a.totalRevenue += rev;
        
        if (String(r.store_invitation).toLowerCase() === 'yes') a.storeInvCount++;
        if (String(r.wa_connection).toLowerCase() === 'yes') a.waCount++;
        if (String(r.video_demo).toLowerCase() === 'yes') a.videoCount++;
        if (String(r.probing_why).toLowerCase() === 'yes') a.probingWhyCount++;
        if (String(r.proactive).toLowerCase() === 'proactive') a.proactiveCount++;
    });

    return { 
        total, 
        salesLeads: total, 
        badCallsCount: badCalls.length, 
        matrix, cityMap, storeMap, priceMap, categoryMap, barrierMap, 
        conversionPercent, 
        totalRevenueFormatted, 
        revPerLeadFormatted,
        arpuFormatted,
        avgNpsAgent,
        avgNpsBrand,
        waConnectionPerc,
        storeInvitationPerc,
        probingWhyPerc,
        probingWhomPerc,
        videoDemoPerc
    };
  }, [filteredCalls]);

  const handleMatrixClick = (intent, exp) => {
    navigate('/listing', { state: { intentFilter: intent, expFilter: exp, startDate, endDate } });
  };

  const navigateToListWithFilter = (key, value) => {
    navigate('/listing', { state: { [key]: value, startDate, endDate } });
  };

  const downloadCSV = (filename, headers, rows) => {
      const csvContent = [
          headers.join(','),
          ...rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      ].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  const exportTableData = (filename, pkName, dataArray, pkField) => {
      const headers = [pkName, '# of Leads', 'Revenue per Lead', 'Conversion %', 'ARPU', '% Bad Calls', 'Avg NPS (Agent)', 'Avg NPS (Brand)', 'Store Invitation %', 'WA Connection %', 'Video Demo %', 'Probing - Why %', 'ProActive %'];
      
      const rows = dataArray.map(obj => {
          const leads = obj.calls;
          const revPerLead = leads > 0 ? '₹' + Math.round(obj.totalRevenue / leads).toLocaleString('en-IN') : '₹0';
          const conversion = leads > 0 ? (obj.convertedCount / leads * 100).toFixed(1) + '%' : '0.0%';
          const arpu = obj.convertedCount > 0 ? '₹' + Math.round(obj.totalRevenue / obj.convertedCount).toLocaleString('en-IN') : '₹0';
          const badCallsPerc = leads > 0 ? (obj.badCalls / leads * 100).toFixed(1) + '%' : '0.0%';
          const npsAgent = obj.countNps > 0 ? Math.round((obj.sumAgent / obj.countNps) * 10) + '%' : '0%';
          const npsBrand = obj.countNps > 0 ? Math.round((obj.sumBrand / obj.countNps) * 10) + '%' : '0%';
          const storeInvPerc = leads > 0 ? Math.round(obj.storeInvCount / leads * 100) + '%' : '0%';
          const waPerc = leads > 0 ? Math.round(obj.waCount / leads * 100) + '%' : '0%';
          const videoPerc = leads > 0 ? Math.round(obj.videoCount / leads * 100) + '%' : '0%';
          const probingWhyPerc = leads > 0 ? Math.round(obj.probingWhyCount / leads * 100) + '%' : '0%';
          const proactivePerc = leads > 0 ? Math.round(obj.proactiveCount / leads * 100) + '%' : '0%';
          
          return [obj[pkField], leads, revPerLead, conversion, arpu, badCallsPerc, npsAgent, npsBrand, storeInvPerc, waPerc, videoPerc, probingWhyPerc, proactivePerc];
      });

      downloadCSV(filename, headers, rows);
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
                <button
                    onClick={() => navigate('/insights')}
                    className="bg-gradient-to-r from-amber-500 to-orange-500 border border-amber-400 shadow-xl shadow-amber-500/30 text-white rounded-2xl px-5 py-3 flex flex-col items-start hover:from-amber-600 hover:to-orange-600 hover:scale-[1.02] transition-all group"
                >
                    <div className="flex items-center gap-2 mb-1">
                        <Sparkles className="w-4 h-4 text-amber-200 group-hover:text-white transition-colors" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-amber-200 group-hover:text-white transition-colors">Insights</span>
                    </div>
                    <span className="text-lg font-black leading-none">Generate Report</span>
                </button>
                <button
                    onClick={() => navigate('/trends')}
                    className="bg-indigo-600 border border-indigo-500 shadow-xl shadow-indigo-600/30 text-white rounded-2xl px-5 py-3 flex flex-col items-start hover:bg-indigo-700 hover:scale-[1.02] transition-all group"
                >
                    <div className="flex items-center gap-2 mb-1">
                        <TrendingUp className="w-4 h-4 text-indigo-200 group-hover:text-white transition-colors" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-indigo-200 group-hover:text-white transition-colors">Trends Dashboard</span>
                    </div>
                    <span className="text-lg font-black leading-none">View KPI Trends</span>
                </button>
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Selected Calls</span>
                    <span className="text-2xl font-black text-indigo-600 leading-none mt-1">{filteredCalls.length}</span>
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
              label="City" 
              value={cityFilter} 
              onChange={setCityFilter} 
              options={Object.keys(cityStoreMapping).sort()} 
            />
            
            <FilterSelect 
              label="Store" 
              value={storeFilter} 
              onChange={setStoreFilter} 
              options={availableStores} 
            />
            
            <FilterSelect 
              label="Call Type" 
              value={callTypeFilter} 
              onChange={setCallTypeFilter} 
              options={[...new Set(data.reports.map(r => r.call_type).filter(Boolean))]} 
            />

            <FilterSelect 
              label="Purchase Intent" 
              value={intentFilter} 
              onChange={setIntentFilter} 
              options={['HIGH', 'MEDIUM', 'LOW']} 
            />

            <FilterSelect 
              label="Visit Intent" 
              value={visitFilter} 
              onChange={setVisitFilter} 
              options={['HIGH', 'MEDIUM', 'LOW']} 
            />

            <FilterSelect 
              label="Agent NPS" 
              value={npsAgentFilter} 
              onChange={setNpsAgentFilter} 
              options={['HIGH', 'MEDIUM', 'LOW']} 
            />

            <FilterSelect 
              label="Brand NPS" 
              value={npsBrandFilter} 
              onChange={setNpsBrandFilter} 
              options={['HIGH', 'MEDIUM', 'LOW']} 
            />

            <FilterSelect 
              label="Category" 
              value={categoryFilter} 
              onChange={setCategoryFilter} 
              options={data.filters.product_categories} 
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
                setCityFilter([]); setStoreFilter([]); setCallTypeFilter([]); setIntentFilter([]);
                setVisitFilter([]); setNpsAgentFilter([]); setNpsBrandFilter([]);
                setCategoryFilter([]); setStartDate(''); setEndDate('');
              }}
              className="ml-auto text-xs font-bold text-red-500 hover:text-red-700"
            >
                Reset All
            </button>
        </div>

        {/* KPI Row */}
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 mb-12">
            <KpiCard 
              label="Total Sales Calls" 
              value={metrics.salesLeads} 
              subtitle="All Calls that specifically had Sales Intent, excluding all Post Purchase Calls" 
              color="indigo" 
              icon={<Users />} 
            />
            <KpiCard 
              label="Revenue per Lead" 
              value={metrics.revPerLeadFormatted} 
              subtitle="Total Revenue received against all Sales leads" 
              color="emerald" 
              icon={<DollarSign />} 
            />
            <KpiCard 
              label="Conversion %" 
              value={`${metrics.conversionPercent}%`} 
              subtitle="What % of Sales Leads placed Ordered" 
              color="emerald" 
              icon={<Target />} 
            />
            <KpiCard 
              label="Revenue" 
              value={metrics.totalRevenueFormatted} 
              subtitle="What is the total Received Revenue against all Sales leads" 
              color="indigo" 
              icon={<DollarSign />} 
            />
            <KpiCard 
              label="ARPU" 
              value={metrics.arpuFormatted} 
              subtitle="Avg Revenue per Converted lead" 
              color="emerald" 
              icon={<Activity />} 
            />
        </div>

        {/* Secondary KPI Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4 mb-12 opacity-90 scale-[0.98] origin-top">
            <SecondaryKpiCard label="AVG NPS (Brand)" value={metrics.avgNpsBrand} />
            <SecondaryKpiCard label="AVG NPS (Agent)" value={metrics.avgNpsAgent} />
            <SecondaryKpiCard label="WA Connection" value={`${metrics.waConnectionPerc}%`} />
            <SecondaryKpiCard label="Store Invitation" value={`${metrics.storeInvitationPerc}%`} />
            <SecondaryKpiCard label="Probing Why" value={`${metrics.probingWhyPerc}%`} />
            <SecondaryKpiCard label="Probing Whom" value={`${metrics.probingWhomPerc}%`} />
            <SecondaryKpiCard label="Video Demo" value={`${metrics.videoDemoPerc}%`} />
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

        {/* City Performance */}
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-200/40 overflow-hidden mb-16">
            <div className="p-8 border-b border-slate-100 flex justify-between items-center">
                <div className="flex items-center gap-4">
                    <div className="bg-fuchsia-100 p-3 rounded-2xl text-fuchsia-600">
                        <MapPin className="w-6 h-6" />
                    </div>
                    <div>
                        <h2 className="text-xl font-black text-slate-900" style={{ fontFamily: "'Fraunces', serif" }}>City Performance</h2>
                        <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-0.5">Aggregated performance metrics per city</p>
                    </div>
                </div>
                <button 
                  onClick={() => exportTableData('city_performance.csv', 'City', Object.values(metrics.cityMap).sort((a,b) => b.calls - a.calls), 'city')}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border border-slate-200"
                >
                    <Download className="w-3.5 h-3.5" /> Export
                </button>
            </div>
            <div className="overflow-x-auto overflow-y-auto max-h-[70vh] w-full custom-scrollbar border-t border-slate-100 relative">
                <table className="w-full text-left min-w-max">
                    <thead className="bg-slate-50 sticky top-0 z-30 shadow-sm">
                        <tr>
                            <th className="p-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest">City</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest"># of Leads</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">Revenue per Lead</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">Conversion %</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">ARPU</th>
                            <th className="p-6 text-center text-[10px] font-bold text-rose-500 uppercase tracking-widest bg-rose-50/30">% Bad Calls</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">Avg NPS (Agent)</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">Avg NPS (Brand)</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest border-l border-slate-100">Store Invitation %</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest">WA Connection %</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest">Video Demo %</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest">Probing - Why %</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest">ProActive %</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {Object.values(metrics.cityMap).sort((a,b) => b.calls - a.calls).map(c => {
                            const leads = c.calls;
                            const revPerLead = leads > 0 ? '₹' + Math.round(c.totalRevenue / leads).toLocaleString('en-IN') : '₹0';
                            const conversion = leads > 0 ? (c.convertedCount / leads * 100).toFixed(1) + '%' : '0.0%';
                            const arpu = c.convertedCount > 0 ? '₹' + Math.round(c.totalRevenue / c.convertedCount).toLocaleString('en-IN') : '₹0';
                            const badCallsPerc = leads > 0 ? (c.badCalls / leads * 100).toFixed(1) + '%' : '0.0%';
                            const npsAgent = c.countNps > 0 ? Math.round((c.sumAgent / c.countNps) * 10) + '%' : '0%';
                            const npsBrand = c.countNps > 0 ? Math.round((c.sumBrand / c.countNps) * 10) + '%' : '0%';
                            const storeInvPerc = leads > 0 ? Math.round(c.storeInvCount / leads * 100) + '%' : '0%';
                            const waPerc = leads > 0 ? Math.round(c.waCount / leads * 100) + '%' : '0%';
                            const videoPerc = leads > 0 ? Math.round(c.videoCount / leads * 100) + '%' : '0%';
                            const probingWhyPerc = leads > 0 ? Math.round(c.probingWhyCount / leads * 100) + '%' : '0%';
                            const proactivePerc = leads > 0 ? Math.round(c.proactiveCount / leads * 100) + '%' : '0%';

                            return (
                                <tr key={c.city} onClick={() => navigateToListWithFilter('cityFilter', c.city)} className="group hover:bg-slate-50 transition-all cursor-pointer">
                                    <td className="p-6">
                                        <div className="font-black text-slate-900 group-hover:text-indigo-600 transition-colors uppercase tracking-tight">{c.city}</div>
                                    </td>
                                    <td className="p-6 text-center font-bold text-slate-600">{leads}</td>
                                    <td className="p-6 text-center font-bold text-sky-600">{revPerLead}</td>
                                    <td className="p-6 text-center font-bold text-emerald-600">{conversion}</td>
                                    <td className="p-6 text-center font-bold text-indigo-600">{arpu}</td>
                                    <td className="p-6 text-center font-black text-rose-500 bg-rose-50/20">{badCallsPerc}</td>
                                    <td className="p-6 text-center font-bold text-slate-900">{npsAgent}</td>
                                    <td className="p-6 text-center font-bold text-slate-900">{npsBrand}</td>
                                    <td className="p-6 text-center text-slate-500 border-l border-slate-50">{storeInvPerc}</td>
                                    <td className="p-6 text-center text-slate-500">{waPerc}</td>
                                    <td className="p-6 text-center text-slate-500">{videoPerc}</td>
                                    <td className="p-6 text-center text-slate-500">{probingWhyPerc}</td>
                                    <td className="p-6 text-center text-slate-500">{proactivePerc}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
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
                <button 
                  onClick={() => exportTableData('store_performance.csv', 'Store', Object.values(metrics.storeMap).sort((a,b) => b.calls - a.calls), 'name')}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border border-slate-200"
                >
                    <Download className="w-3.5 h-3.5" /> Export
                </button>
            </div>
            <div className="overflow-x-auto overflow-y-auto max-h-[70vh] w-full custom-scrollbar border-t border-slate-100 relative">
                <table className="w-full text-left min-w-max">
                    <thead className="bg-slate-50 sticky top-0 z-30 shadow-sm">
                        <tr>
                            <th className="p-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Store Details</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest"># of Leads</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">Revenue per Lead</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">Conversion %</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">ARPU</th>
                            <th className="p-6 text-center text-[10px] font-bold text-rose-500 uppercase tracking-widest bg-rose-50/30">% Bad Calls</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">Avg NPS (Agent)</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">Avg NPS (Brand)</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest border-l border-slate-100">Store Invitation %</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest">WA Connection %</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest">Video Demo %</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest">Probing - Why %</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest">ProActive %</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {Object.values(metrics.storeMap).sort((a,b) => b.calls - a.calls).map(s => {
                            const leads = s.calls;
                            const revPerLead = leads > 0 ? '₹' + Math.round(s.totalRevenue / leads).toLocaleString('en-IN') : '₹0';
                            const conversion = leads > 0 ? (s.convertedCount / leads * 100).toFixed(1) + '%' : '0.0%';
                            const arpu = s.convertedCount > 0 ? '₹' + Math.round(s.totalRevenue / s.convertedCount).toLocaleString('en-IN') : '₹0';
                            const badCallsPerc = leads > 0 ? (s.badCalls / leads * 100).toFixed(1) + '%' : '0.0%';
                            const npsAgent = s.countNps > 0 ? Math.round((s.sumAgent / s.countNps) * 10) + '%' : '0%';
                            const npsBrand = s.countNps > 0 ? Math.round((s.sumBrand / s.countNps) * 10) + '%' : '0%';
                            const storeInvPerc = leads > 0 ? Math.round(s.storeInvCount / leads * 100) + '%' : '0%';
                            const waPerc = leads > 0 ? Math.round(s.waCount / leads * 100) + '%' : '0%';
                            const videoPerc = leads > 0 ? Math.round(s.videoCount / leads * 100) + '%' : '0%';
                            const probingWhyPerc = leads > 0 ? Math.round(s.probingWhyCount / leads * 100) + '%' : '0%';
                            const proactivePerc = leads > 0 ? Math.round(s.proactiveCount / leads * 100) + '%' : '0%';

                            return (
                                <tr key={s.name} onClick={() => navigateToListWithFilter('storeFilter', s.name)} className="group hover:bg-slate-50 transition-all cursor-pointer">
                                    <td className="p-6">
                                        <div className="font-black text-slate-900 group-hover:text-indigo-600 transition-colors uppercase tracking-tight">{s.name}</div>
                                        <div className="text-xs text-slate-400 font-bold">{s.city}</div>
                                    </td>
                                    <td className="p-6 text-center font-bold text-slate-600">{leads}</td>
                                    <td className="p-6 text-center font-bold text-sky-600">{revPerLead}</td>
                                    <td className="p-6 text-center font-bold text-emerald-600">{conversion}</td>
                                    <td className="p-6 text-center font-bold text-indigo-600">{arpu}</td>
                                    <td className="p-6 text-center font-black text-rose-500 bg-rose-50/20">{badCallsPerc}</td>
                                    <td className="p-6 text-center font-bold text-slate-900">{npsAgent}</td>
                                    <td className="p-6 text-center font-bold text-slate-900">{npsBrand}</td>
                                    <td className="p-6 text-center text-slate-500 border-l border-slate-50">{storeInvPerc}</td>
                                    <td className="p-6 text-center text-slate-500">{waPerc}</td>
                                    <td className="p-6 text-center text-slate-500">{videoPerc}</td>
                                    <td className="p-6 text-center text-slate-500">{probingWhyPerc}</td>
                                    <td className="p-6 text-center text-slate-500">{proactivePerc}</td>
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
                <button 
                  onClick={() => exportTableData('price_bucket_performance.csv', 'Income/Price Group', Object.values(metrics.priceMap).sort((a,b) => b.calls - a.calls), 'bucket')}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border border-slate-200"
                >
                    <Download className="w-3.5 h-3.5" /> Export
                </button>
            </div>
            <div className="overflow-x-auto overflow-y-auto max-h-[70vh] w-full custom-scrollbar border-t border-slate-100 relative">
                <table className="w-full text-left min-w-max">
                    <thead className="bg-slate-50 sticky top-0 z-30 shadow-sm">
                        <tr>
                            <th className="p-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Income/Price Group</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest"># of Leads</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">Revenue per Lead</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">Conversion %</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">ARPU</th>
                            <th className="p-6 text-center text-[10px] font-bold text-rose-500 uppercase tracking-widest bg-rose-50/30">% Bad Calls</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">Avg NPS (Agent)</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">Avg NPS (Brand)</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest border-l border-slate-100">Store Invitation %</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest">WA Connection %</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest">Video Demo %</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest">Probing - Why %</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest">ProActive %</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {Object.values(metrics.priceMap).sort((a,b) => b.calls - a.calls).map(b => {
                            const leads = b.calls;
                            const revPerLead = leads > 0 ? '₹' + Math.round(b.totalRevenue / leads).toLocaleString('en-IN') : '₹0';
                            const conversion = leads > 0 ? (b.convertedCount / leads * 100).toFixed(1) + '%' : '0.0%';
                            const arpu = b.convertedCount > 0 ? '₹' + Math.round(b.totalRevenue / b.convertedCount).toLocaleString('en-IN') : '₹0';
                            const badCallsPerc = leads > 0 ? (b.badCalls / leads * 100).toFixed(1) + '%' : '0.0%';
                            const npsAgent = b.countNps > 0 ? Math.round((b.sumAgent / b.countNps) * 10) + '%' : '0%';
                            const npsBrand = b.countNps > 0 ? Math.round((b.sumBrand / b.countNps) * 10) + '%' : '0%';
                            const storeInvPerc = leads > 0 ? Math.round(b.storeInvCount / leads * 100) + '%' : '0%';
                            const waPerc = leads > 0 ? Math.round(b.waCount / leads * 100) + '%' : '0%';
                            const videoPerc = leads > 0 ? Math.round(b.videoCount / leads * 100) + '%' : '0%';
                            const probingWhyPerc = leads > 0 ? Math.round(b.probingWhyCount / leads * 100) + '%' : '0%';
                            const proactivePerc = leads > 0 ? Math.round(b.proactiveCount / leads * 100) + '%' : '0%';

                            return (
                                <tr key={b.bucket} onClick={() => navigateToListWithFilter('priceFilter', b.bucket)} className="group hover:bg-slate-50 transition-all cursor-pointer">
                                    <td className="p-6">
                                        <div className="font-black text-slate-900 group-hover:text-indigo-600 transition-colors uppercase tracking-tight">{b.bucket}</div>
                                        <div className="text-[10px] text-emerald-600 font-bold uppercase tracking-widest">Segment Data</div>
                                    </td>
                                    <td className="p-6 text-center font-bold text-slate-600">{leads}</td>
                                    <td className="p-6 text-center font-bold text-sky-600">{revPerLead}</td>
                                    <td className="p-6 text-center font-bold text-emerald-600">{conversion}</td>
                                    <td className="p-6 text-center font-bold text-indigo-600">{arpu}</td>
                                    <td className="p-6 text-center font-black text-rose-500 bg-rose-50/20">{badCallsPerc}</td>
                                    <td className="p-6 text-center font-bold text-slate-900">{npsAgent}</td>
                                    <td className="p-6 text-center font-bold text-slate-900">{npsBrand}</td>
                                    <td className="p-6 text-center text-slate-500 border-l border-slate-50">{storeInvPerc}</td>
                                    <td className="p-6 text-center text-slate-500">{waPerc}</td>
                                    <td className="p-6 text-center text-slate-500">{videoPerc}</td>
                                    <td className="p-6 text-center text-slate-500">{probingWhyPerc}</td>
                                    <td className="p-6 text-center text-slate-500">{proactivePerc}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>

        {/* Product Category wise Performance */}
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-200/40 overflow-hidden mt-16">
            <div className="p-8 border-b border-slate-100 flex justify-between items-center">
                <div className="flex items-center gap-4">
                    <div className="bg-blue-100 p-3 rounded-2xl text-blue-600">
                        <ShoppingCart className="w-6 h-6" />
                    </div>
                    <div>
                        <h2 className="text-xl font-black text-slate-900" style={{ fontFamily: "'Fraunces', serif" }}>Product Category wise Performance</h2>
                        <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-0.5">Top 15 Categories by Volume</p>
                    </div>
                </div>
                <button 
                  onClick={() => exportTableData('product_category_performance.csv', 'Category', Object.values(metrics.categoryMap).sort((a,b) => b.calls - a.calls).slice(0, 15), 'category')}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border border-slate-200"
                >
                    <Download className="w-3.5 h-3.5" /> Export
                </button>
            </div>
            <div className="overflow-x-auto overflow-y-auto max-h-[70vh] w-full custom-scrollbar border-t border-slate-100 relative">
                <table className="w-full text-left min-w-max">
                    <thead className="bg-slate-50 sticky top-0 z-30 shadow-sm">
                        <tr>
                            <th className="p-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Category</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest"># of Leads</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">Revenue per Lead</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">Conversion %</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">ARPU</th>
                            <th className="p-6 text-center text-[10px] font-bold text-rose-500 uppercase tracking-widest bg-rose-50/30">% Bad Calls</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">Avg NPS (Agent)</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">Avg NPS (Brand)</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest border-l border-slate-100">Store Invitation %</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest">WA Connection %</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest">Video Demo %</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest">Probing - Why %</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest">ProActive %</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {Object.values(metrics.categoryMap).sort((a,b) => b.calls - a.calls).slice(0, 15).map(c => {
                            const leads = c.calls;
                            const revPerLead = leads > 0 ? '₹' + Math.round(c.totalRevenue / leads).toLocaleString('en-IN') : '₹0';
                            const conversion = leads > 0 ? (c.convertedCount / leads * 100).toFixed(1) + '%' : '0.0%';
                            const arpu = c.convertedCount > 0 ? '₹' + Math.round(c.totalRevenue / c.convertedCount).toLocaleString('en-IN') : '₹0';
                            const badCallsPerc = leads > 0 ? (c.badCalls / leads * 100).toFixed(1) + '%' : '0.0%';
                            const npsAgent = c.countNps > 0 ? Math.round((c.sumAgent / c.countNps) * 10) + '%' : '0%';
                            const npsBrand = c.countNps > 0 ? Math.round((c.sumBrand / c.countNps) * 10) + '%' : '0%';
                            const storeInvPerc = leads > 0 ? Math.round(c.storeInvCount / leads * 100) + '%' : '0%';
                            const waPerc = leads > 0 ? Math.round(c.waCount / leads * 100) + '%' : '0%';
                            const videoPerc = leads > 0 ? Math.round(c.videoCount / leads * 100) + '%' : '0%';
                            const probingWhyPerc = leads > 0 ? Math.round(c.probingWhyCount / leads * 100) + '%' : '0%';
                            const proactivePerc = leads > 0 ? Math.round(c.proactiveCount / leads * 100) + '%' : '0%';

                            return (
                                <tr key={c.category} onClick={() => navigateToListWithFilter('categoryFilter', c.category)} className="group hover:bg-slate-50 transition-all cursor-pointer">
                                    <td className="p-6">
                                        <div className="font-black text-slate-900 group-hover:text-indigo-600 transition-colors uppercase tracking-tight">{c.category}</div>
                                    </td>
                                    <td className="p-6 text-center font-bold text-slate-600">{leads}</td>
                                    <td className="p-6 text-center font-bold text-sky-600">{revPerLead}</td>
                                    <td className="p-6 text-center font-bold text-emerald-600">{conversion}</td>
                                    <td className="p-6 text-center font-bold text-indigo-600">{arpu}</td>
                                    <td className="p-6 text-center font-black text-rose-500 bg-rose-50/20">{badCallsPerc}</td>
                                    <td className="p-6 text-center font-bold text-slate-900">{npsAgent}</td>
                                    <td className="p-6 text-center font-bold text-slate-900">{npsBrand}</td>
                                    <td className="p-6 text-center text-slate-500 border-l border-slate-50">{storeInvPerc}</td>
                                    <td className="p-6 text-center text-slate-500">{waPerc}</td>
                                    <td className="p-6 text-center text-slate-500">{videoPerc}</td>
                                    <td className="p-6 text-center text-slate-500">{probingWhyPerc}</td>
                                    <td className="p-6 text-center text-slate-500">{proactivePerc}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>

        {/* Purchase Barrier Performance */}
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-200/40 overflow-hidden mt-16">
            <div className="p-8 border-b border-slate-100 flex justify-between items-center">
                <div className="flex items-center gap-4">
                    <div className="bg-red-100 p-3 rounded-2xl text-red-600">
                        <TrendingDown className="w-6 h-6" />
                    </div>
                    <div>
                        <h2 className="text-xl font-black text-slate-900" style={{ fontFamily: "'Fraunces', serif" }}>Purchase Barrier Performance</h2>
                        <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-0.5">Performance across Primary Purchase Barriers</p>
                    </div>
                </div>
                <button 
                  onClick={() => exportTableData('purchase_barrier_performance.csv', 'Barrier', Object.values(metrics.barrierMap).sort((a,b) => b.calls - a.calls), 'barrier')}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border border-slate-200"
                >
                    <Download className="w-3.5 h-3.5" /> Export
                </button>
            </div>
            <div className="overflow-x-auto overflow-y-auto max-h-[70vh] w-full custom-scrollbar border-t border-slate-100 relative">
                <table className="w-full text-left min-w-max">
                    <thead className="bg-slate-50 sticky top-0 z-30 shadow-sm">
                        <tr>
                            <th className="p-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Barrier</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest"># of Leads</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">Revenue per Lead</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">Conversion %</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">ARPU</th>
                            <th className="p-6 text-center text-[10px] font-bold text-rose-500 uppercase tracking-widest bg-rose-50/30">% Bad Calls</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">Avg NPS (Agent)</th>
                            <th className="p-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">Avg NPS (Brand)</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest border-l border-slate-100">Store Invitation %</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest">WA Connection %</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest">Video Demo %</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest">Probing - Why %</th>
                            <th className="p-6 text-center text-[10px] font-bold text-amber-600 uppercase tracking-widest">ProActive %</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {Object.values(metrics.barrierMap).sort((a,b) => b.calls - a.calls).map(c => {
                            const leads = c.calls;
                            const revPerLead = leads > 0 ? '₹' + Math.round(c.totalRevenue / leads).toLocaleString('en-IN') : '₹0';
                            const conversion = leads > 0 ? (c.convertedCount / leads * 100).toFixed(1) + '%' : '0.0%';
                            const arpu = c.convertedCount > 0 ? '₹' + Math.round(c.totalRevenue / c.convertedCount).toLocaleString('en-IN') : '₹0';
                            const badCallsPerc = leads > 0 ? (c.badCalls / leads * 100).toFixed(1) + '%' : '0.0%';
                            const npsAgent = c.countNps > 0 ? Math.round((c.sumAgent / c.countNps) * 10) + '%' : '0%';
                            const npsBrand = c.countNps > 0 ? Math.round((c.sumBrand / c.countNps) * 10) + '%' : '0%';
                            const storeInvPerc = leads > 0 ? Math.round(c.storeInvCount / leads * 100) + '%' : '0%';
                            const waPerc = leads > 0 ? Math.round(c.waCount / leads * 100) + '%' : '0%';
                            const videoPerc = leads > 0 ? Math.round(c.videoCount / leads * 100) + '%' : '0%';
                            const probingWhyPerc = leads > 0 ? Math.round(c.probingWhyCount / leads * 100) + '%' : '0%';
                            const proactivePerc = leads > 0 ? Math.round(c.proactiveCount / leads * 100) + '%' : '0%';

                            return (
                                <tr key={c.barrier} onClick={() => navigateToListWithFilter('barrierFilter', c.barrier)} className="group hover:bg-slate-50 transition-all cursor-pointer">
                                    <td className="p-6">
                                        <div className="font-black text-slate-900 group-hover:text-indigo-600 transition-colors uppercase tracking-tight">{c.barrier}</div>
                                    </td>
                                    <td className="p-6 text-center font-bold text-slate-600">{leads}</td>
                                    <td className="p-6 text-center font-bold text-sky-600">{revPerLead}</td>
                                    <td className="p-6 text-center font-bold text-emerald-600">{conversion}</td>
                                    <td className="p-6 text-center font-bold text-indigo-600">{arpu}</td>
                                    <td className="p-6 text-center font-black text-rose-500 bg-rose-50/20">{badCallsPerc}</td>
                                    <td className="p-6 text-center font-bold text-slate-900">{npsAgent}</td>
                                    <td className="p-6 text-center font-bold text-slate-900">{npsBrand}</td>
                                    <td className="p-6 text-center text-slate-500 border-l border-slate-50">{storeInvPerc}</td>
                                    <td className="p-6 text-center text-slate-500">{waPerc}</td>
                                    <td className="p-6 text-center text-slate-500">{videoPerc}</td>
                                    <td className="p-6 text-center text-slate-500">{probingWhyPerc}</td>
                                    <td className="p-6 text-center text-slate-500">{proactivePerc}</td>
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
        <div className="flex flex-col gap-1.5 relative group">
            <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest px-1">{label}</span>
            <button 
                onClick={() => setIsOpen(!isOpen)}
                className="bg-slate-50 border border-slate-100 text-[11px] font-bold text-slate-700 px-4 py-2.5 flex items-center justify-between gap-3 min-w-[120px] rounded-xl hover:bg-white focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500/30 transition-all outline-none"
            >
                <span>{displayCount}</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400"><path d="m6 9 6 6 6-6"/></svg>
            </button>
            
            {isOpen && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)}></div>
                    <div className="absolute top-[100%] left-0 mt-2 w-56 bg-white border border-slate-100 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.1)] rounded-2xl z-50 py-2 max-h-64 overflow-y-auto overflow-x-hidden">
                        {options.map(o => {
                            if (o === 'All') return null;
                            const isSelected = value.includes(o);
                            return (
                                <button 
                                    key={o} 
                                    onClick={() => toggleOption(o)}
                                    className="w-full text-left px-4 py-2 hover:bg-slate-50/80 flex items-center gap-3 transition-colors group/item"
                                >
                                    <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${isSelected ? 'bg-indigo-600 border-indigo-600 shadow-md shadow-indigo-600/30' : 'bg-slate-50 border-slate-200 group-hover/item:border-indigo-300'}`}>
                                        {isSelected && <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>}
                                    </div>
                                    <span className={`text-xs font-bold leading-tight ${isSelected ? 'text-slate-900' : 'text-slate-500'} break-words whitespace-normal`}>{o}</span>
                                </button>
                            );
                        })}
                        {options.length === 0 && (
                            <div className="px-4 py-2 text-xs text-slate-400 font-bold uppercase tracking-widest text-center">No Options</div>
                        )}
                    </div>
                </>
            )}
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
                <span className="text-4xl font-black text-slate-900 tracking-tighter" style={{ fontFamily: "'Fraunces', serif" }}>
                    {value}
                </span>
                <span className="text-[11px] text-slate-400 font-medium leading-snug mt-1">{subtitle}</span>
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

function SecondaryKpiCard({ label, value }) {
    return (
        <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-xl shadow-slate-200/40 hover:-translate-y-1 transition-all duration-300 flex flex-col items-center justify-center text-center">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-snug mb-1">{label}</span>
            <span className="text-xl font-black text-slate-800" style={{ fontFamily: "'Fraunces', serif" }}>{value}</span>
        </div>
    );
}
