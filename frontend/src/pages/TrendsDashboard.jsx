import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Activity, Calendar, SlidersHorizontal, MapPin, Target, ShoppingCart, TrendingDown, Check, ChevronDown, Download } from 'lucide-react';
import { fetchAnalyticsData, parseDate } from '../utils/api';
import * as XLSX from 'xlsx';

const KPI_OPTIONS = [
    { id: 'leads', label: '# of Leads' },
    { id: 'revenue_per_lead', label: 'Revenue per lead' },
    { id: 'conversion', label: 'Conversion %' },
    { id: 'arpu', label: 'ARPU' },
    { id: 'nps_brand', label: 'Avg NPS (Brand)' },
    { id: 'nps_agent', label: 'Avg NPS (Agent)' },
    { id: 'video_demo', label: 'Video Demo %' },
    { id: 'wa_connection', label: 'WA Connection %' },
    { id: 'bad_calls', label: '% Bad Calls' },
    { id: 'store_invitation', label: 'Store Invitation %' },
    { id: 'probing_why', label: 'Probing - Why %' },
    { id: 'proactive', label: 'ProActive %' },
];

const DEFAULT_KPIS = ['leads', 'revenue_per_lead', 'conversion', 'arpu', 'nps_brand', 'nps_agent', 'video_demo', 'wa_connection'];

function getMondayOfWeek(inputDate) {
    const date = new Date(inputDate);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    date.setDate(diff);
    date.setHours(0,0,0,0);
    return date;
}

function formatDateToWeekStr(mondayDate) {
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const day = mondayDate.getDate();
    const month = monthNames[mondayDate.getMonth()];
    const year = mondayDate.getFullYear().toString().substr(-2);
    return `Wk of ${day} ${month} '${year}`;
}

export default function TrendsDashboard() {
    const navigate = useNavigate();
    const [data, setData] = useState({ reports: [] });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [selectedKPIs, setSelectedKPIs] = useState(DEFAULT_KPIS);
    const [startDate, setStartDate] = useState('2025-03-02');
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

    const processTrendData = useMemo(() => {
        let validReports = [];

        // Pre-filter reports by Date 
        data.reports.forEach(r => {
            const d = parseDate(r.call_date);
            if (!d) return;
            const dTime = d.getTime();

            if (startDate) {
                const s = new Date(startDate);
                s.setHours(0,0,0,0);
                if (dTime < s.getTime()) return;
            }
            if (endDate) {
                const e = new Date(endDate);
                e.setHours(23,59,59,999);
                if (dTime > e.getTime()) return;
            }
            
            // Map each report to a week
            const monday = getMondayOfWeek(d);
            const weekTs = monday.getTime();
            const weekStr = formatDateToWeekStr(monday);
            
            validReports.push({ ...r, _weekTs: weekTs, _weekStr: weekStr });
        });

        // Collect all distinct weeks, sorted chronologically
        const uniqueWeeksMap = {};
        validReports.forEach(r => uniqueWeeksMap[r._weekTs] = r._weekStr);
        const sortedWeekTimes = Object.keys(uniqueWeeksMap).map(Number).sort((a,b) => a - b);
        const sortedWeeks = sortedWeekTimes.map(ts => ({ ts, label: uniqueWeeksMap[ts] }));

        function aggregateToMatrix(dimensionKey) {
            const matrix = {};
            // Entity Totals (for strict sorting by Lead Volume)
            const entityTotals = {};

            validReports.forEach(r => {
                const entity = String(r[dimensionKey] || 'Unknown').trim();
                
                if (!entityTotals[entity]) entityTotals[entity] = 0;
                entityTotals[entity]++; // Count leads
                
                if (!matrix[entity]) {
                    matrix[entity] = {};
                }
                const w = r._weekTs;
                if (!matrix[entity][w]) {
                    matrix[entity][w] = {
                        calls: 0, badCalls: 0,
                        convertedCount: 0, totalRevenue: 0, sumAgent: 0, sumBrand: 0, countNps: 0,
                        storeInvCount: 0, waCount: 0, videoCount: 0, probingWhyCount: 0, proactiveCount: 0
                    };
                }
                
                const cell = matrix[entity][w];
                cell.calls++;
                if (r.intent_rating === 'HIGH' && r.experience_rating !== 'HIGH') cell.badCalls++;
                
                if (String(r.is_converted) === "1" || String(r.is_converted).toLowerCase() === "true" || String(r.is_converted).toLowerCase() === "yes") {
                    cell.convertedCount++;
                }
                if (r.revenue) {
                    const rev = parseFloat(String(r.revenue).replace(/[^0-9.-]+/g, "")) || 0;
                    cell.totalRevenue += rev;
                }
                
                cell.sumAgent += r.nps_agent || 0;
                cell.sumBrand += r.nps_brand || 0;
                cell.countNps++;
                
                if (String(r.store_invitation).toLowerCase() === 'yes') cell.storeInvCount++;
                if (String(r.wa_connection).toLowerCase() === 'yes') cell.waCount++;
                if (String(r.video_demo).toLowerCase() === 'yes') cell.videoCount++;
                if (String(r.probing_why).toLowerCase() === 'yes') cell.probingWhyCount++;
                if (String(r.proactive).toLowerCase() === 'proactive') cell.proactiveCount++;
            });

            // Sort entities descending by total leads
            const sortedEntities = Object.keys(entityTotals).sort((a,b) => entityTotals[b] - entityTotals[a]);
            
            return { matrix, sortedEntities };
        }

        return {
            weeks: sortedWeeks,
            storeData: aggregateToMatrix('store_name'),
            cityData: aggregateToMatrix('city'),
            categoryData: aggregateToMatrix('product_category'),
            barrierData: aggregateToMatrix('purchase_barrier')
        };

    }, [data.reports, startDate, endDate]);

    const toggleKPI = (id) => {
        if (selectedKPIs.includes(id)) {
            setSelectedKPIs(selectedKPIs.filter(k => k !== id));
        } else {
            setSelectedKPIs([...selectedKPIs, id]);
        }
    };

    const formatMetric = (metricId, cell) => {
        if (!cell || cell.calls === 0) return { val: '-', raw: 0 };
        
        switch (metricId) {
            case 'leads': return { val: cell.calls.toString(), raw: cell.calls };
            case 'revenue_per_lead': {
                const v = Math.round(cell.totalRevenue / cell.calls);
                return { val: '₹' + v.toLocaleString('en-IN'), raw: v };
            }
            case 'conversion': {
                const v = (cell.convertedCount / cell.calls) * 100;
                return { val: v.toFixed(1) + '%', raw: v };
            }
            case 'arpu': {
                const v = cell.convertedCount > 0 ? Math.round(cell.totalRevenue / cell.convertedCount) : 0;
                return { val: '₹' + v.toLocaleString('en-IN'), raw: v };
            }
            case 'nps_brand': {
                const v = cell.countNps > 0 ? Math.round((cell.sumBrand / cell.countNps) * 10) : 0;
                return { val: `${v}%`, raw: v };
            }
            case 'nps_agent': {
                const v = cell.countNps > 0 ? Math.round((cell.sumAgent / cell.countNps) * 10) : 0;
                return { val: `${v}%`, raw: v };
            }
            case 'bad_calls': {
                const v = (cell.badCalls / cell.calls) * 100;
                return { val: v.toFixed(1) + '%', raw: v };
            }
            case 'store_invitation': return { val: Math.round((cell.storeInvCount / cell.calls) * 100) + '%', raw: cell.storeInvCount };
            case 'wa_connection': return { val: Math.round((cell.waCount / cell.calls) * 100) + '%', raw: cell.waCount };
            case 'video_demo': return { val: Math.round((cell.videoCount / cell.calls) * 100) + '%', raw: cell.videoCount };
            case 'probing_why': return { val: Math.round((cell.probingWhyCount / cell.calls) * 100) + '%', raw: cell.probingWhyCount };
            case 'proactive': return { val: Math.round((cell.proactiveCount / cell.calls) * 100) + '%', raw: cell.proactiveCount };
            default: return { val: '-', raw: 0 };
        }
    };

    if (loading) return (
        <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
            <p className="text-gray-500 font-bold uppercase tracking-widest text-xs">Computing Trend Matrices...</p>
        </div>
    );
    if (error) return <div className="p-20 text-center text-red-500 font-bold">{error}</div>;

    const orderedKPIs = KPI_OPTIONS.filter(k => selectedKPIs.includes(k.id));

    return (
        <div className="min-h-screen bg-[#f8fafc] text-slate-900 pb-20" style={{ fontFamily: "'DM Sans', sans-serif" }}>
            <div className="max-w-[1700px] mx-auto px-8 py-10">
                {/* Header */}
                <div className="flex justify-between items-start mb-10">
                    <div>
                        <button 
                          onClick={() => navigate('/')}
                          className="text-[10px] font-black text-indigo-600 mb-2 flex items-center gap-1 hover:gap-2 transition-all uppercase tracking-[0.2em]"
                        >
                            <ArrowLeft className="w-3 h-3" /> Back to Dashboard
                        </button>
                        <h1 className="text-4xl font-black text-slate-900 tracking-tight mb-2" style={{ fontFamily: "'Fraunces', serif" }}>
                            KPI Trends Analysis
                        </h1>
                        <p className="text-slate-500 font-medium">Longitudinal visibility across hierarchical dimensions</p>
                    </div>
                </div>

                {/* Filter Toolbar */}
                <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-xl shadow-slate-200/50 flex flex-wrap gap-6 items-center mb-10 relative z-10">
                    
                    {/* Date Filters */}
                    <div className="flex items-center gap-4 pr-6 border-r border-slate-100">
                        <Calendar className="w-5 h-5 text-indigo-500" />
                        <div className="flex items-center gap-3">
                            <div className="flex flex-col">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Week From</span>
                                <input 
                                  type="date" 
                                  value={startDate}
                                  onChange={(e) => setStartDate(e.target.value)}
                                  className="text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                                />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Week To</span>
                                <input 
                                  type="date" 
                                  value={endDate}
                                  onChange={(e) => setEndDate(e.target.value)}
                                  className="text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                                />
                            </div>
                        </div>
                    </div>

                    {/* KPI Multi-select Dropdown (Custom implementation inline) */}
                    <Dropdown 
                       label="Active KPIs"
                       selectedCount={selectedKPIs.length}
                    >
                        <div className="p-2 grid grid-cols-2 gap-2">
                            {KPI_OPTIONS.map(kpi => (
                                <button 
                                  key={kpi.id} 
                                  onClick={() => toggleKPI(kpi.id)}
                                  className={`text-left px-3 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-between ${selectedKPIs.includes(kpi.id) ? 'bg-indigo-50 text-indigo-700 border border-indigo-200/50 shadow-sm' : 'bg-slate-50 text-slate-500 border border-transparent hover:bg-slate-100'}`}
                                >
                                    <span>{kpi.label}</span>
                                    {selectedKPIs.includes(kpi.id) && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                                </button>
                            ))}
                        </div>
                    </Dropdown>

                    <button 
                        onClick={() => { setStartDate(''); setEndDate(''); setSelectedKPIs(DEFAULT_KPIS); }}
                        className="ml-auto text-xs font-bold text-red-500 border border-red-100 bg-red-50 px-4 py-2 rounded-xl hover:bg-red-100 transition-colors"
                    >
                        Reset Defaults
                    </button>
                </div>

                {/* Data Grids */}
                <div className="flex flex-col gap-12">
                    <TrendGrid 
                      title="City Trends" 
                      icon={<MapPin className="w-5 h-5" />} 
                      color="emerald"
                      dataModel={processTrendData.cityData} 
                      weeks={processTrendData.weeks} 
                      kpis={orderedKPIs} 
                      formatMetric={formatMetric} 
                    />

                    <TrendGrid 
                      title="Store Trends" 
                      icon={<MapPin className="w-5 h-5" />} 
                      color="indigo"
                      dataModel={processTrendData.storeData} 
                      weeks={processTrendData.weeks} 
                      kpis={orderedKPIs} 
                      formatMetric={formatMetric} 
                    />

                    <TrendGrid 
                      title="Product Category Trends" 
                      icon={<ShoppingCart className="w-5 h-5" />} 
                      color="sky"
                      dataModel={processTrendData.categoryData} 
                      weeks={processTrendData.weeks} 
                      kpis={orderedKPIs} 
                      formatMetric={formatMetric} 
                    />

                    <TrendGrid 
                      title="Purchase Barrier Trends" 
                      icon={<TrendingDown className="w-5 h-5" />} 
                      color="rose"
                      dataModel={processTrendData.barrierData} 
                      weeks={processTrendData.weeks} 
                      kpis={orderedKPIs} 
                      formatMetric={formatMetric} 
                    />
                </div>
            </div>
        </div>
    );
}

function Dropdown({ label, selectedCount, children }) {
    const [open, setOpen] = useState(false);
    return (
        <div className="relative">
            <button 
              onClick={() => setOpen(!open)}
              className="flex items-center gap-3 bg-slate-50 border border-slate-200 px-4 py-2 rounded-xl hover:bg-white transition-all shadow-sm group"
            >
                <SlidersHorizontal className="w-4 h-4 text-indigo-500" />
                <div className="flex flex-col text-left">
                    <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">{label}</span>
                    <span className="text-xs font-black text-slate-700">{selectedCount} Selected</span>
                </div>
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpen(false)}></div>
                    <div className="absolute top-[100%] left-0 mt-3 bg-white border border-slate-200 shadow-2xl rounded-2xl z-50 w-[400px]">
                        {children}
                    </div>
                </>
            )}
        </div>
    );
}

function TrendGrid({ title, icon, color, dataModel, weeks, kpis, formatMetric }) {
    if (weeks.length === 0) return null;

    const bgColors = {
        indigo: 'bg-indigo-50 text-indigo-600',
        emerald: 'bg-emerald-50 text-emerald-600',
        sky: 'bg-sky-50 text-sky-600',
        rose: 'bg-rose-50 text-rose-600'
    };

    const exportToExcel = () => {
        const wsData = [];
        // Header
        const header = ['Entity', 'Metrics', ...weeks.map(w => w.label)];
        wsData.push(header);

        // Body
        dataModel.sortedEntities.forEach(entity => {
            const cells = dataModel.matrix[entity];
            kpis.forEach((kpi, idx) => {
                const row = [
                    idx === 0 ? entity : '', // Show entity only on the first row of its group to mimic the view
                    kpi.label
                ];
                weeks.forEach(w => {
                    const cellData = cells[w.ts];
                    const m = formatMetric(kpi.id, cellData);
                    // use the raw unformatted number if we want Excel to interpret it as a number,
                    // but since some are percentages, 'val' is cleaner for an "exact view" export
                    row.push(m.val);
                });
                wsData.push(row);
            });
        });

        const ws = XLSX.utils.aoa_to_sheet(wsData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Trends');
        XLSX.writeFile(wb, `${title.replace(/\s+/g, '_')}_Trends.xlsx`);
    };

    return (
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-200/40 overflow-hidden">
            <div className="p-8 border-b border-slate-100 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-2xl ${bgColors[color]}`}>
                        {icon}
                    </div>
                    <div>
                        <h2 className="text-xl font-black text-slate-900" style={{ fontFamily: "'Fraunces', serif" }}>{title}</h2>
                        <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-0.5">Rows sorted by Total Lead Volume</p>
                    </div>
                </div>
                <button 
                  onClick={exportToExcel}
                  className="flex items-center gap-2 bg-white border border-slate-200 text-slate-600 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-colors shadow-sm"
                >
                    <Download className="w-4 h-4" /> Export
                </button>
            </div>

            <div className="overflow-x-auto overflow-y-auto max-h-[70vh] w-full custom-scrollbar border-t border-slate-100 relative">
                <table className="w-full text-left min-w-max border-collapse">
                    <thead>
                        <tr>
                            <th className="p-6 sticky top-0 left-0 z-40 bg-slate-50 shadow-[2px_2px_10px_rgba(0,0,0,0.02)] min-w-[200px] max-w-[250px]">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Entity</span>
                            </th>
                            <th className="p-6 sticky top-0 z-30 min-w-[120px] bg-slate-50 border-l border-b border-slate-200/50">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Metrics</span>
                            </th>
                            {weeks.map(w => (
                                <th key={w.ts} className="p-6 sticky top-0 z-30 text-center text-[10px] font-bold text-indigo-700 uppercase tracking-widest bg-indigo-50 border-l border-b border-indigo-100 shadow-sm">
                                    {w.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {dataModel.sortedEntities.map(entity => {
                            const cells = dataModel.matrix[entity];
                            return (
                                <tr key={entity} className="group hover:bg-slate-50/50 transition-colors">
                                    <td className="p-6 sticky left-0 z-20 bg-white group-hover:bg-slate-50 shadow-[2px_0_10px_rgba(0,0,0,0.02)] border-r border-slate-100 max-w-[250px] align-top">
                                        <div className="font-black text-slate-800 uppercase tracking-tight text-sm break-words whitespace-pre-wrap">{entity}</div>
                                    </td>
                                    <td className="p-0 border-l border-slate-100 align-top">
                                        <div className="flex flex-col h-full divide-y divide-slate-50 text-slate-600 bg-slate-50/30">
                                            {kpis.map(kpi => (
                                                <div key={kpi.id} className="px-4 py-2.5 text-xs font-bold w-full whitespace-nowrap overflow-hidden text-ellipsis">
                                                    {kpi.label}
                                                </div>
                                            ))}
                                        </div>
                                    </td>
                                    {weeks.map(w => {
                                        const cellData = cells[w.ts];
                                        return (
                                            <td key={w.ts} className="p-0 border-l border-slate-100 align-top bg-white">
                                                <div className="flex flex-col h-full divide-y divide-slate-50 text-center">
                                                    {kpis.map(kpi => {
                                                        const m = formatMetric(kpi.id, cellData);
                                                        return (
                                                            <div key={kpi.id} className="px-4 py-2.5 text-xs font-bold text-slate-700 flex items-center justify-center relative group/cell">
                                                                {m.val}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {dataModel.sortedEntities.length === 0 && (
                <div className="p-10 text-center text-slate-400 font-bold uppercase tracking-widest text-xs">
                    No data found for the selected dates
                </div>
            )}
        </div>
    );
}
