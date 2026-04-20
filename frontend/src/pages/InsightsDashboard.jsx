import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Sparkles, Calendar, MapPin, ShoppingCart, TrendingDown, ChevronDown, Check, FileText, Loader2, AlertTriangle, ThumbsUp, ThumbsDown, Rocket, Building2, Tag, Download } from 'lucide-react';
import { fetchAnalyticsData, parseDate, generateInsightsReport } from '../utils/api';
import cityStoreMapping from '../utils/city_store_mapping.json';

export default function InsightsDashboard() {
    const navigate = useNavigate();
    const [data, setData] = useState({ reports: [] });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Mode
    const [mode, setMode] = useState('single'); // 'single' or 'compare'

    // Filters Set A
    const [selectedCities, setSelectedCities] = useState([]);
    const [selectedStores, setSelectedStores] = useState([]);
    const [selectedCategories, setSelectedCategories] = useState([]);
    const [selectedBarriers, setSelectedBarriers] = useState([]);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    // Filters Set B (for Compare mode)
    const [selectedCitiesB, setSelectedCitiesB] = useState([]);
    const [selectedStoresB, setSelectedStoresB] = useState([]);
    const [selectedCategoriesB, setSelectedCategoriesB] = useState([]);
    const [selectedBarriersB, setSelectedBarriersB] = useState([]);
    const [startDateB, setStartDateB] = useState('');
    const [endDateB, setEndDateB] = useState('');

    // Custom Question
    const [customQuestion, setCustomQuestion] = useState('');

    // Report state
    const [generating, setGenerating] = useState(false);
    const [report, setReport] = useState(null);
    const [reportError, setReportError] = useState('');

    useEffect(() => {
        fetchAnalyticsData()
            .then(setData)
            .catch(err => {
                console.error(err);
                setError('Failed to load analytics data');
            })
            .finally(() => setLoading(false));
    }, []);

    // Derive unique filter options from data
    const filterOptions = useMemo(() => {
        const cities = new Set();
        const stores = new Set();
        const categories = new Set();
        const barriers = new Set();
        data.reports.forEach(r => {
            if (r.city) cities.add(r.city);
            if (r.store_name) stores.add(r.store_name);
            if (r.product_category) categories.add(r.product_category);
            if (r.purchase_barrier) barriers.add(r.purchase_barrier);
        });
        return {
            cities: [...cities].sort(),
            stores: [...stores].sort(),
            categories: [...categories].sort(),
            barriers: [...barriers].sort()
        };
    }, [data.reports]);

    const availableStores = useMemo(() => {
        if (selectedCities.length === 0) return filterOptions.stores;
        let stores = [];
        selectedCities.forEach(city => {
            if (cityStoreMapping[city]) {
                stores = stores.concat(cityStoreMapping[city]);
            }
        });
        return [...new Set(stores)].sort();
    }, [selectedCities, filterOptions.stores]);

    const availableStoresB = useMemo(() => {
        if (selectedCitiesB.length === 0) return filterOptions.stores;
        let stores = [];
        selectedCitiesB.forEach(city => {
            if (cityStoreMapping[city]) {
                stores = stores.concat(cityStoreMapping[city]);
            }
        });
        return [...new Set(stores)].sort();
    }, [selectedCitiesB, filterOptions.stores]);

    useEffect(() => {
        if (selectedCities.length > 0 && selectedStores.length > 0) {
            const validStores = selectedStores.filter(s => availableStores.includes(s));
            if (validStores.length !== selectedStores.length) {
                setSelectedStores(validStores);
            }
        }
    }, [availableStores, selectedCities, selectedStores]);

    useEffect(() => {
        if (selectedCitiesB.length > 0 && selectedStoresB.length > 0) {
            const validStores = selectedStoresB.filter(s => availableStoresB.includes(s));
            if (validStores.length !== selectedStoresB.length) {
                setSelectedStoresB(validStores);
            }
        }
    }, [availableStoresB, selectedCitiesB, selectedStoresB]);

    // Filtered calls Set A
    const filteredCalls = useMemo(() => {
        return data.reports.filter(r => {
            if (r.call_type !== 'PRE_PURCHASE (Pre Store Visit)' && r.call_type !== 'PRE_PURCHASE (Post Store Visit)') {
                return false;
            }
            if (selectedCities.length > 0 && !selectedCities.includes(r.city)) return false;
            if (selectedStores.length > 0 && !selectedStores.includes(r.store_name)) return false;
            if (selectedCategories.length > 0 && !selectedCategories.includes(r.product_category)) return false;
            if (selectedBarriers.length > 0 && !selectedBarriers.includes(r.purchase_barrier)) return false;

            if (startDate || endDate) {
                const d = parseDate(r.call_date);
                if (!d) return false;
                if (startDate) {
                    const s = new Date(startDate);
                    s.setHours(0, 0, 0, 0);
                    if (d.getTime() < s.getTime()) return false;
                }
                if (endDate) {
                    const e = new Date(endDate);
                    e.setHours(23, 59, 59, 999);
                    if (d.getTime() > e.getTime()) return false;
                }
            }
            return true;
        });
    }, [data.reports, selectedCities, selectedStores, selectedCategories, selectedBarriers, startDate, endDate]);

    // Filtered calls Set B
    const filteredCallsB = useMemo(() => {
        return data.reports.filter(r => {
            if (r.call_type !== 'PRE_PURCHASE (Pre Store Visit)' && r.call_type !== 'PRE_PURCHASE (Post Store Visit)') {
                return false;
            }
            if (selectedCitiesB.length > 0 && !selectedCitiesB.includes(r.city)) return false;
            if (selectedStoresB.length > 0 && !selectedStoresB.includes(r.store_name)) return false;
            if (selectedCategoriesB.length > 0 && !selectedCategoriesB.includes(r.product_category)) return false;
            if (selectedBarriersB.length > 0 && !selectedBarriersB.includes(r.purchase_barrier)) return false;

            if (startDateB || endDateB) {
                const d = parseDate(r.call_date);
                if (!d) return false;
                if (startDateB) {
                    const s = new Date(startDateB);
                    s.setHours(0, 0, 0, 0);
                    if (d.getTime() < s.getTime()) return false;
                }
                if (endDateB) {
                    const e = new Date(endDateB);
                    e.setHours(23, 59, 59, 999);
                    if (d.getTime() > e.getTime()) return false;
                }
            }
            return true;
        });
    }, [data.reports, selectedCitiesB, selectedStoresB, selectedCategoriesB, selectedBarriersB, startDateB, endDateB]);

    const isOverCap = filteredCalls.length > 100 || (mode === 'compare' && filteredCallsB.length > 100);
    const isEmpty = filteredCalls.length === 0 || (mode === 'compare' && filteredCallsB.length === 0);

    const buildSegmentDesc = (cities, stores, categories, barriers) => {
        const parts = [];
        if (cities.length) parts.push(`Cities: ${cities.join(', ')}`);
        if (stores.length) parts.push(`Stores: ${stores.join(', ')}`);
        if (categories.length) parts.push(`Categories: ${categories.join(', ')}`);
        if (barriers.length) parts.push(`Barriers: ${barriers.join(', ')}`);
        return parts.length ? parts.join(' | ') : 'All segments (no filters applied)';
    };

    const buildDateRange = (sDate, eDate) => {
        if (sDate && eDate) return `${sDate} to ${eDate}`;
        if (sDate) return `From ${sDate}`;
        if (eDate) return `Until ${eDate}`;
        return 'Full date range';
    };

    const handleGenerate = async () => {
        setGenerating(true);
        setReportError('');
        setReport(null);

        const cleanNumbers = filteredCalls.map(r => r.clean_number);
        const descA = buildSegmentDesc(selectedCities, selectedStores, selectedCategories, selectedBarriers);
        const dateA = buildDateRange(startDate, endDate);

        let cleanNumbersB = null;
        let descB = null;
        let dateB = null;

        if (mode === 'compare') {
            cleanNumbersB = filteredCallsB.map(r => r.clean_number);
            descB = buildSegmentDesc(selectedCitiesB, selectedStoresB, selectedCategoriesB, selectedBarriersB);
            dateB = buildDateRange(startDateB, endDateB);
        }

        try {
            const res = await generateInsightsReport(cleanNumbers, descA, dateA, customQuestion, cleanNumbersB, descB, dateB);
            if (res.status === 'success') {
                setReport(res.report);
            } else {
                setReportError('Unexpected response from server');
            }
        } catch (err) {
            setReportError(err.message || 'Failed to generate report');
        } finally {
            setGenerating(false);
        }
    };

    const handlePrintReport = () => {
        window.print();
    };

    if (loading) return (
        <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-600"></div>
            <p className="text-gray-500 font-bold uppercase tracking-widest text-xs">Loading Data...</p>
        </div>
    );
    if (error) return <div className="p-20 text-center text-red-500 font-bold">{error}</div>;

    return (
        <div className="min-h-screen bg-[#f8fafc] text-slate-900 pb-20" style={{ fontFamily: "'DM Sans', sans-serif" }}>
            <div className="max-w-[1500px] mx-auto px-8 py-10">

                {/* Header */}
                <div className="flex justify-between items-start mb-10 print:hidden">
                    <div>
                        <button
                            onClick={() => navigate('/')}
                            className="text-[10px] font-black text-amber-600 mb-2 flex items-center gap-1 hover:gap-2 transition-all uppercase tracking-[0.2em]"
                        >
                            <ArrowLeft className="w-3 h-3" /> Back to Dashboard
                        </button>
                        <h1 className="text-4xl font-black text-slate-900 tracking-tight mb-2" style={{ fontFamily: "'Fraunces', serif" }}>
                            Insights Dashboard
                        </h1>
                        <p className="text-slate-500 font-medium">AI-powered executive reports from your call data</p>
                    </div>
                    {/* Toggle Mode */}
                    <div className="flex items-center bg-white rounded-xl p-1 shadow-sm border border-slate-200">
                        <button
                            onClick={() => setMode('single')}
                            className={`px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${mode === 'single' ? 'bg-amber-100 text-amber-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                            Single View
                        </button>
                        <button
                            onClick={() => setMode('compare')}
                            className={`px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${mode === 'compare' ? 'bg-amber-100 text-amber-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                            Compare
                        </button>
                    </div>
                </div>

                {/* Filter Panel A */}
                <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-xl shadow-slate-200/50 mb-6 print:hidden relative">
                    {mode === 'compare' && (
                        <div className="absolute -top-3 left-8 bg-amber-100 text-amber-700 px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border border-amber-200">
                            Dataset A
                        </div>
                    )}
                    <div className="flex flex-wrap gap-4 items-end pt-2">

                        {/* City Filter */}
                        <FilterDropdown
                            label="City"
                            icon={<MapPin className="w-4 h-4 text-emerald-500" />}
                            options={filterOptions.cities}
                            selected={selectedCities}
                            setSelected={setSelectedCities}
                        />

                        {/* Store Filter */}
                        <FilterDropdown
                            label="Store"
                            icon={<Building2 className="w-4 h-4 text-indigo-500" />}
                            options={availableStores}
                            selected={selectedStores}
                            setSelected={setSelectedStores}
                        />

                        {/* Product Category Filter */}
                        <FilterDropdown
                            label="Product Category"
                            icon={<ShoppingCart className="w-4 h-4 text-sky-500" />}
                            options={filterOptions.categories}
                            selected={selectedCategories}
                            setSelected={setSelectedCategories}
                        />

                        {/* Purchase Barrier Filter */}
                        <FilterDropdown
                            label="Purchase Barrier"
                            icon={<TrendingDown className="w-4 h-4 text-rose-500" />}
                            options={filterOptions.barriers}
                            selected={selectedBarriers}
                            setSelected={setSelectedBarriers}
                        />

                        {/* Date Range */}
                        <div className="flex items-center gap-3 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl">
                            <Calendar className="w-4 h-4 text-amber-500" />
                            <div className="flex gap-3">
                                <div className="flex flex-col">
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">From</span>
                                    <input
                                        type="date"
                                        value={startDate}
                                        onChange={e => setStartDate(e.target.value)}
                                        className="text-xs font-bold text-slate-700 bg-transparent border-none focus:outline-none w-[120px]"
                                    />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">To</span>
                                    <input
                                        type="date"
                                        value={endDate}
                                        onChange={e => setEndDate(e.target.value)}
                                        className="text-xs font-bold text-slate-700 bg-transparent border-none focus:outline-none w-[120px]"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Reset */}
                        <button
                            onClick={() => {
                                setSelectedCities([]);
                                setSelectedStores([]);
                                setSelectedCategories([]);
                                setSelectedBarriers([]);
                                setStartDate('');
                                setEndDate('');
                            }}
                            className="text-xs font-bold text-red-500 border border-red-100 bg-red-50 px-4 py-2 rounded-xl hover:bg-red-100 transition-colors"
                        >
                            Reset
                        </button>
                    </div>
                </div>

                {/* Filter Panel B (Only in Compare Mode) */}
                {mode === 'compare' && (
                    <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-xl shadow-slate-200/50 mb-6 print:hidden relative">
                        <div className="absolute -top-3 left-8 bg-indigo-100 text-indigo-700 px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border border-indigo-200">
                            Dataset B
                        </div>
                        <div className="flex flex-wrap gap-4 items-end pt-2">

                            {/* City Filter */}
                            <FilterDropdown
                                label="City"
                                icon={<MapPin className="w-4 h-4 text-emerald-500" />}
                                options={filterOptions.cities}
                                selected={selectedCitiesB}
                                setSelected={setSelectedCitiesB}
                            />

                            {/* Store Filter */}
                            <FilterDropdown
                                label="Store"
                                icon={<Building2 className="w-4 h-4 text-indigo-500" />}
                                options={availableStoresB}
                                selected={selectedStoresB}
                                setSelected={setSelectedStoresB}
                            />

                            {/* Product Category Filter */}
                            <FilterDropdown
                                label="Product Category"
                                icon={<ShoppingCart className="w-4 h-4 text-sky-500" />}
                                options={filterOptions.categories}
                                selected={selectedCategoriesB}
                                setSelected={setSelectedCategoriesB}
                            />

                            {/* Purchase Barrier Filter */}
                            <FilterDropdown
                                label="Purchase Barrier"
                                icon={<TrendingDown className="w-4 h-4 text-rose-500" />}
                                options={filterOptions.barriers}
                                selected={selectedBarriersB}
                                setSelected={setSelectedBarriersB}
                            />

                            {/* Date Range */}
                            <div className="flex items-center gap-3 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl">
                                <Calendar className="w-4 h-4 text-indigo-500" />
                                <div className="flex gap-3">
                                    <div className="flex flex-col">
                                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">From</span>
                                        <input
                                            type="date"
                                            value={startDateB}
                                            onChange={e => setStartDateB(e.target.value)}
                                            className="text-xs font-bold text-slate-700 bg-transparent border-none focus:outline-none w-[120px]"
                                        />
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">To</span>
                                        <input
                                            type="date"
                                            value={endDateB}
                                            onChange={e => setEndDateB(e.target.value)}
                                            className="text-xs font-bold text-slate-700 bg-transparent border-none focus:outline-none w-[120px]"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Reset */}
                            <button
                                onClick={() => {
                                    setSelectedCitiesB([]);
                                    setSelectedStoresB([]);
                                    setSelectedCategoriesB([]);
                                    setSelectedBarriersB([]);
                                    setStartDateB('');
                                    setEndDateB('');
                                }}
                                className="text-xs font-bold text-red-500 border border-red-100 bg-red-50 px-4 py-2 rounded-xl hover:bg-red-100 transition-colors"
                            >
                                Reset
                            </button>
                        </div>
                    </div>
                )}

                {/* Common Action Panel (Custom Question + Submit) */}
                <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-xl shadow-slate-200/50 mb-10 print:hidden">
                    {/* Custom Question */}
                    <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Custom Question for AI (Optional)</label>
                        <textarea
                            value={customQuestion}
                            onChange={(e) => setCustomQuestion(e.target.value)}
                            placeholder="E.g., What are the main reasons customers didn't visit the store this week?"
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all resize-none h-16 text-slate-700 font-medium placeholder:text-slate-400"
                        />
                    </div>

                    {/* Bottom bar: Call count + Generate button */}
                    <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-between">
                        <div className="flex items-center gap-6">
                            <div className="flex flex-col border-r border-slate-100 pr-6">
                                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{mode === 'compare' ? 'Set A Calls' : 'Selected Calls'}</span>
                                <span className={`text-3xl font-black leading-none mt-1 ${filteredCalls.length > 100 ? 'text-red-500' : 'text-amber-600'}`}>
                                    {filteredCalls.length}
                                </span>
                            </div>
                            {mode === 'compare' && (
                                <div className="flex flex-col border-r border-slate-100 pr-6">
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Set B Calls</span>
                                    <span className={`text-3xl font-black leading-none mt-1 ${filteredCallsB.length > 100 ? 'text-red-500' : 'text-indigo-600'}`}>
                                        {filteredCallsB.length}
                                    </span>
                                </div>
                            )}
                            
                            {isOverCap && (
                                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2 text-red-600 animate-pulse">
                                    <AlertTriangle className="w-4 h-4" />
                                    <span className="text-xs font-bold">Sorry, maximum 100 calls allowed per dataset. Please narrow down your search.</span>
                                </div>
                            )}
                        </div>

                        <button
                            onClick={handleGenerate}
                            disabled={isOverCap || isEmpty || generating}
                            className={`flex items-center gap-3 px-8 py-3.5 rounded-2xl text-sm font-black uppercase tracking-widest transition-all shadow-lg ${isOverCap || isEmpty || generating
                                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                                    : 'bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600 hover:scale-[1.02] shadow-amber-500/30'
                                }`}
                        >
                            {generating ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    Generating...
                                </>
                            ) : (
                                <>
                                    <Sparkles className="w-5 h-5" />
                                    Generate Report
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* Loading State */}
                {generating && (
                    <div className="flex flex-col items-center gap-6 py-16">
                        <div className="relative">
                            <div className="absolute inset-0 bg-amber-400/20 blur-3xl rounded-full animate-pulse"></div>
                            <Sparkles className="relative w-16 h-16 text-amber-500 animate-bounce" />
                        </div>
                        <p className="text-slate-500 font-bold text-sm uppercase tracking-widest">
                            ✨ Gemini is analysing {mode === 'compare' ? `${filteredCalls.length} (Set A) vs ${filteredCallsB.length} (Set B)` : filteredCalls.length} calls...
                        </p>
                        <p className="text-slate-400 text-xs">This typically takes 15–30 seconds</p>

                        {/* Skeleton cards */}
                        <div className="w-full grid grid-cols-1 gap-6 mt-8">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="bg-white rounded-3xl border border-slate-200 p-8 animate-pulse">
                                    <div className="h-6 bg-slate-100 rounded-xl w-1/3 mb-6"></div>
                                    <div className="grid grid-cols-2 gap-8">
                                        <div className="space-y-3">
                                            <div className="h-4 bg-slate-100 rounded w-full"></div>
                                            <div className="h-4 bg-slate-100 rounded w-4/5"></div>
                                            <div className="h-4 bg-slate-100 rounded w-3/5"></div>
                                        </div>
                                        <div className="space-y-3">
                                            <div className="h-4 bg-slate-100 rounded w-full"></div>
                                            <div className="h-4 bg-slate-100 rounded w-4/5"></div>
                                            <div className="h-4 bg-slate-100 rounded w-3/5"></div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Error State */}
                {reportError && !generating && (
                    <div className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center mb-10">
                        <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-4" />
                        <p className="text-red-600 font-bold mb-2">{reportError}</p>
                        <button
                            onClick={handleGenerate}
                            className="text-xs font-bold text-red-600 border border-red-200 px-4 py-2 rounded-xl hover:bg-red-100 transition-colors mt-2"
                        >
                            Retry
                        </button>
                    </div>
                )}

                {/* Empty State (no report yet) */}
                {!report && !generating && !reportError && (
                    <div className="flex flex-col items-center justify-center py-24 text-center print:hidden">
                        <div className="relative mb-8">
                            <div className="absolute inset-0 bg-amber-100 blur-3xl rounded-full opacity-50"></div>
                            <FileText className="relative w-20 h-20 text-slate-300" />
                        </div>
                        <h3 className="text-xl font-black text-slate-400 mb-2" style={{ fontFamily: "'Fraunces', serif" }}>
                            No Report Generated Yet
                        </h3>
                        <p className="text-slate-400 text-sm max-w-md">
                            Select your filters above and click <strong>"Generate Report"</strong> to create an AI-powered executive summary from your call data.
                        </p>
                    </div>
                )}

                {/* Report Output */}
                {report && !generating && !report.parse_error && (
                    <div id="insights-report">
                        {/* Report Header */}
                        <div className="flex items-center justify-between mb-8 print:mb-4">
                            <div>
                                <h2 className="text-2xl font-black text-slate-900" style={{ fontFamily: "'Fraunces', serif" }}>
                                    Executive Insights Report
                                </h2>
                                <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">
                                    {mode === 'compare' ? (
                                        <>Set A: {buildSegmentDesc(selectedCities, selectedStores, selectedCategories, selectedBarriers)} | {buildDateRange(startDate, endDate)} ({filteredCalls.length} calls) <br/> 
                                        Set B: {buildSegmentDesc(selectedCitiesB, selectedStoresB, selectedCategoriesB, selectedBarriersB)} | {buildDateRange(startDateB, endDateB)} ({filteredCallsB.length} calls)</>
                                    ) : (
                                        <>{buildSegmentDesc(selectedCities, selectedStores, selectedCategories, selectedBarriers)} · {buildDateRange(startDate, endDate)} · {filteredCalls.length} calls analysed</>
                                    )}
                                </p>
                            </div>
                            <button
                                onClick={handlePrintReport}
                                className="flex items-center gap-2 bg-white border border-slate-200 text-slate-600 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-slate-50 transition-colors shadow-sm print:hidden"
                            >
                                <Download className="w-4 h-4" /> Download PDF
                            </button>
                        </div>

                        {/* Brand Analysis Card */}
                        <InsightCard
                            title="Brand Analysis"
                            icon={<Tag className="w-5 h-5" />}
                            accentColor="indigo"
                            goodItems={report.brand_good || []}
                            badItems={report.brand_bad || []}
                        />

                        {/* Store & Staff Card */}
                        <InsightCard
                            title="Store & Staff Analysis"
                            icon={<Building2 className="w-5 h-5" />}
                            accentColor="amber"
                            goodItems={report.store_good || []}
                            badItems={report.store_bad || []}
                        />

                        {/* Next Steps Card */}
                        <div className="bg-white rounded-[2rem] border border-slate-200 shadow-xl shadow-slate-200/40 overflow-hidden mb-8">
                            <div className="p-8 border-b border-slate-100 flex items-center gap-4">
                                <div className="p-3 rounded-2xl bg-sky-50 text-sky-600">
                                    <Rocket className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="text-xl font-black text-slate-900" style={{ fontFamily: "'Fraunces', serif" }}>
                                        Recommended Next Steps
                                    </h3>
                                    <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-0.5">Actionable recommendations</p>
                                </div>
                            </div>
                            <div className="p-8">
                                <div className="space-y-5">
                                    {(report.next_steps || []).map((item, idx) => (
                                        <div key={idx} className="flex gap-4 items-start group">
                                            <div className="flex-shrink-0 w-9 h-9 bg-sky-50 border border-sky-200 rounded-xl flex items-center justify-center text-sky-600 font-black text-sm group-hover:bg-sky-100 transition-colors">
                                                {idx + 1}
                                            </div>
                                            <div className="flex-1">
                                                <h4 className="font-black text-slate-800 text-sm mb-1">{item.title}</h4>
                                                <p className="text-slate-500 text-sm leading-relaxed">{item.detail}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Custom Answer Card */}
                        {report.custom_answer && (
                            <div className="bg-white rounded-[2rem] border border-slate-200 shadow-xl shadow-slate-200/40 overflow-hidden mb-8">
                                <div className="p-8 border-b border-slate-100 flex items-center gap-4">
                                    <div className="p-3 rounded-2xl bg-fuchsia-50 text-fuchsia-600">
                                        <Sparkles className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-black text-slate-900" style={{ fontFamily: "'Fraunces', serif" }}>
                                            Answer to your Question
                                        </h3>
                                        <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-0.5">Q: {report.custom_answer.question || customQuestion}</p>
                                    </div>
                                </div>
                                <div className="p-8">
                                    <div className="space-y-5">
                                        {(report.custom_answer.answer_points || []).map((item, idx) => (
                                            <div key={idx} className="flex gap-4 items-start group">
                                                <div className="flex-shrink-0 w-9 h-9 bg-fuchsia-50 border border-fuchsia-200 rounded-xl flex items-center justify-center text-fuchsia-600 font-black text-sm group-hover:bg-fuchsia-100 transition-colors">
                                                    {idx + 1}
                                                </div>
                                                <div className="flex-1">
                                                    <h4 className="font-black text-slate-800 text-sm mb-1">{item.title}</h4>
                                                    <p className="text-slate-500 text-sm leading-relaxed">{item.detail}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Fallback: raw text if Gemini didn't return valid JSON */}
                {report && report.parse_error && !generating && (
                    <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
                        <h3 className="font-bold text-slate-700 mb-4">Report (Raw Output)</h3>
                        <pre className="whitespace-pre-wrap text-sm text-slate-600 bg-slate-50 p-6 rounded-xl border border-slate-100 leading-relaxed">
                            {report.raw_text}
                        </pre>
                    </div>
                )}
            </div>

            {/* Print-only styles */}
            <style>{`
                @media print {
                    body { background: white !important; }
                    .print\\:hidden { display: none !important; }
                    .print\\:mb-4 { margin-bottom: 1rem !important; }
                    #insights-report { padding: 20px; }
                }
            `}</style>
        </div>
    );
}


// ════════════════════════════════════════════════════════════════════════════════
// Sub-components
// ════════════════════════════════════════════════════════════════════════════════

function FilterDropdown({ label, icon, options, selected, setSelected }) {
    const [open, setOpen] = useState(false);

    const toggle = (value) => {
        if (selected.includes(value)) {
            setSelected(selected.filter(v => v !== value));
        } else {
            setSelected([...selected, value]);
        }
    };

    return (
        <div className="relative">
            <button
                onClick={() => setOpen(!open)}
                className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-4 py-2.5 rounded-xl hover:bg-white transition-all shadow-sm"
            >
                {icon}
                <div className="flex flex-col text-left">
                    <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">{label}</span>
                    <span className="text-xs font-bold text-slate-700">
                        {selected.length === 0 ? 'All' : `${selected.length} selected`}
                    </span>
                </div>
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpen(false)}></div>
                    <div className="absolute top-[100%] left-0 mt-2 bg-white border border-slate-200 shadow-2xl rounded-2xl z-50 w-[280px] max-h-[300px] overflow-y-auto p-2">
                        {options.length === 0 && (
                            <p className="text-xs text-slate-400 p-3 text-center">No options</p>
                        )}
                        {options.map(opt => (
                            <button
                                key={opt}
                                onClick={() => toggle(opt)}
                                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-between mb-0.5 ${selected.includes(opt)
                                        ? 'bg-amber-50 text-amber-700 border border-amber-200/50'
                                        : 'bg-slate-50 text-slate-600 border border-transparent hover:bg-slate-100'
                                    }`}
                            >
                                <span className="truncate">{opt}</span>
                                {selected.includes(opt) && <Check className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}


function InsightCard({ title, icon, accentColor, goodItems, badItems }) {
    const colors = {
        indigo: { bg: 'bg-indigo-50', text: 'text-indigo-600' },
        amber: { bg: 'bg-amber-50', text: 'text-amber-600' },
    };
    const c = colors[accentColor] || colors.indigo;

    return (
        <div className="bg-white rounded-[2rem] border border-slate-200 shadow-xl shadow-slate-200/40 overflow-hidden mb-8">
            <div className="p-8 border-b border-slate-100 flex items-center gap-4">
                <div className={`p-3 rounded-2xl ${c.bg} ${c.text}`}>
                    {icon}
                </div>
                <div>
                    <h3 className="text-xl font-black text-slate-900" style={{ fontFamily: "'Fraunces', serif" }}>
                        {title}
                    </h3>
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-0.5">Good vs. Areas of Concern</p>
                </div>
            </div>
            <div className="grid grid-cols-2 divide-x divide-slate-100">
                {/* Good Column */}
                <div className="p-8">
                    <div className="flex items-center gap-2 mb-6">
                        <ThumbsUp className="w-4 h-4 text-emerald-500" />
                        <span className="text-xs font-black text-emerald-600 uppercase tracking-widest">Good Aspects</span>
                    </div>
                    <div className="space-y-5">
                        {goodItems.map((item, idx) => (
                            <div key={idx} className="flex gap-3 items-start">
                                <div className="flex-shrink-0 w-7 h-7 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-center text-emerald-600 font-black text-xs">
                                    {idx + 1}
                                </div>
                                <div>
                                    <h4 className="font-black text-slate-800 text-sm mb-0.5">{item.title}</h4>
                                    <p className="text-slate-500 text-xs leading-relaxed">{item.detail}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Bad Column */}
                <div className="p-8">
                    <div className="flex items-center gap-2 mb-6">
                        <ThumbsDown className="w-4 h-4 text-rose-500" />
                        <span className="text-xs font-black text-rose-600 uppercase tracking-widest">Areas of Concern</span>
                    </div>
                    <div className="space-y-5">
                        {badItems.map((item, idx) => (
                            <div key={idx} className="flex gap-3 items-start">
                                <div className="flex-shrink-0 w-7 h-7 bg-rose-50 border border-rose-200 rounded-lg flex items-center justify-center text-rose-600 font-black text-xs">
                                    {idx + 1}
                                </div>
                                <div>
                                    <h4 className="font-black text-slate-800 text-sm mb-0.5">{item.title}</h4>
                                    <p className="text-slate-500 text-xs leading-relaxed">{item.detail}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
