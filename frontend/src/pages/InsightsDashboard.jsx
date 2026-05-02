import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Sparkles, Calendar, MapPin, ShoppingCart, TrendingDown, ChevronDown, Check, FileText, Loader2, AlertTriangle, ThumbsUp, ThumbsDown, Rocket, Building2, Tag, Download, BarChart3, Phone, Target, Footprints, Star, Users, Award, Activity, DollarSign, CheckCircle } from 'lucide-react';
import { fetchAnalyticsData, parseDate, generateInsightsReport, npsBucket, isConverted } from '../utils/api';
import cityStoreMapping from '../utils/city_store_mapping.json';

// Default Call Type filter — preserves Insights Dashboard's pre-existing
// behavior of looking only at pre-purchase calls. Users can widen via the
// Call Type dropdown.
const DEFAULT_CALL_TYPES = ['PRE_PURCHASE (Pre Store Visit)', 'PRE_PURCHASE (Post Store Visit)'];
const RATING_OPTIONS = ['HIGH', 'MEDIUM', 'LOW'];
const CONVERTED_OPTIONS = ['YES', 'NO'];

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
    const [selectedCallTypes, setSelectedCallTypes] = useState(DEFAULT_CALL_TYPES);
    const [selectedIntents, setSelectedIntents] = useState([]);
    const [selectedVisits, setSelectedVisits] = useState([]);
    const [selectedExperiences, setSelectedExperiences] = useState([]);
    const [selectedAgentNps, setSelectedAgentNps] = useState([]);
    const [selectedBrandNps, setSelectedBrandNps] = useState([]);
    const [selectedCategories, setSelectedCategories] = useState([]);
    const [selectedFunnels, setSelectedFunnels] = useState([]);
    const [selectedPrices, setSelectedPrices] = useState([]);
    const [selectedBarriers, setSelectedBarriers] = useState([]);
    const [selectedConverted, setSelectedConverted] = useState([]);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    // Filters Set B (for Compare mode)
    const [selectedCitiesB, setSelectedCitiesB] = useState([]);
    const [selectedStoresB, setSelectedStoresB] = useState([]);
    const [selectedCallTypesB, setSelectedCallTypesB] = useState(DEFAULT_CALL_TYPES);
    const [selectedIntentsB, setSelectedIntentsB] = useState([]);
    const [selectedVisitsB, setSelectedVisitsB] = useState([]);
    const [selectedExperiencesB, setSelectedExperiencesB] = useState([]);
    const [selectedAgentNpsB, setSelectedAgentNpsB] = useState([]);
    const [selectedBrandNpsB, setSelectedBrandNpsB] = useState([]);
    const [selectedCategoriesB, setSelectedCategoriesB] = useState([]);
    const [selectedFunnelsB, setSelectedFunnelsB] = useState([]);
    const [selectedPricesB, setSelectedPricesB] = useState([]);
    const [selectedBarriersB, setSelectedBarriersB] = useState([]);
    const [selectedConvertedB, setSelectedConvertedB] = useState([]);
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
        const callTypes = new Set();
        const categories = new Set();
        const funnels = new Set();
        const prices = new Set();
        const barriers = new Set();
        data.reports.forEach(r => {
            if (r.city) cities.add(r.city);
            if (r.store_name) stores.add(r.store_name);
            if (r.call_type) callTypes.add(r.call_type);
            if (r.product_category) categories.add(r.product_category);
            if (r.funnel_stage) funnels.add(r.funnel_stage);
            if (r.price_bucket) prices.add(r.price_bucket);
            if (r.purchase_barrier) barriers.add(r.purchase_barrier);
        });
        return {
            cities: [...cities].sort(),
            stores: [...stores].sort(),
            callTypes: [...callTypes].sort(),
            categories: [...categories].sort(),
            funnels: [...funnels].sort(),
            prices: [...prices].sort(),
            barriers: [...barriers].sort(),
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
            if (selectedCallTypes.length > 0 && !selectedCallTypes.includes(r.call_type)) return false;
            if (selectedCities.length > 0 && !selectedCities.includes(r.city)) return false;
            if (selectedStores.length > 0 && !selectedStores.includes(r.store_name)) return false;
            if (selectedIntents.length > 0 && !selectedIntents.includes(r.intent_rating)) return false;
            if (selectedVisits.length > 0 && !selectedVisits.includes(r.visit_rating)) return false;
            if (selectedExperiences.length > 0 && !selectedExperiences.includes(r.experience_rating)) return false;
            if (selectedAgentNps.length > 0 && !selectedAgentNps.includes(npsBucket(r.nps_agent))) return false;
            if (selectedBrandNps.length > 0 && !selectedBrandNps.includes(npsBucket(r.nps_brand))) return false;
            if (selectedCategories.length > 0 && !selectedCategories.includes(r.product_category)) return false;
            if (selectedFunnels.length > 0 && !selectedFunnels.includes(r.funnel_stage)) return false;
            if (selectedPrices.length > 0 && !selectedPrices.includes(r.price_bucket)) return false;
            if (selectedBarriers.length > 0 && !selectedBarriers.includes(r.purchase_barrier)) return false;
            if (selectedConverted.length > 0) {
                const conv = isConverted(r);
                const wantYes = selectedConverted.includes('YES');
                const wantNo = selectedConverted.includes('NO');
                if (!((wantYes && conv) || (wantNo && !conv))) return false;
            }

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
    }, [data.reports, selectedCallTypes, selectedCities, selectedStores, selectedIntents, selectedVisits, selectedExperiences, selectedAgentNps, selectedBrandNps, selectedCategories, selectedFunnels, selectedPrices, selectedBarriers, selectedConverted, startDate, endDate]);

    // Filtered calls Set B
    const filteredCallsB = useMemo(() => {
        return data.reports.filter(r => {
            if (selectedCallTypesB.length > 0 && !selectedCallTypesB.includes(r.call_type)) return false;
            if (selectedCitiesB.length > 0 && !selectedCitiesB.includes(r.city)) return false;
            if (selectedStoresB.length > 0 && !selectedStoresB.includes(r.store_name)) return false;
            if (selectedIntentsB.length > 0 && !selectedIntentsB.includes(r.intent_rating)) return false;
            if (selectedVisitsB.length > 0 && !selectedVisitsB.includes(r.visit_rating)) return false;
            if (selectedExperiencesB.length > 0 && !selectedExperiencesB.includes(r.experience_rating)) return false;
            if (selectedAgentNpsB.length > 0 && !selectedAgentNpsB.includes(npsBucket(r.nps_agent))) return false;
            if (selectedBrandNpsB.length > 0 && !selectedBrandNpsB.includes(npsBucket(r.nps_brand))) return false;
            if (selectedCategoriesB.length > 0 && !selectedCategoriesB.includes(r.product_category)) return false;
            if (selectedFunnelsB.length > 0 && !selectedFunnelsB.includes(r.funnel_stage)) return false;
            if (selectedPricesB.length > 0 && !selectedPricesB.includes(r.price_bucket)) return false;
            if (selectedBarriersB.length > 0 && !selectedBarriersB.includes(r.purchase_barrier)) return false;
            if (selectedConvertedB.length > 0) {
                const conv = isConverted(r);
                const wantYes = selectedConvertedB.includes('YES');
                const wantNo = selectedConvertedB.includes('NO');
                if (!((wantYes && conv) || (wantNo && !conv))) return false;
            }

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
    }, [data.reports, selectedCallTypesB, selectedCitiesB, selectedStoresB, selectedIntentsB, selectedVisitsB, selectedExperiencesB, selectedAgentNpsB, selectedBrandNpsB, selectedCategoriesB, selectedFunnelsB, selectedPricesB, selectedBarriersB, selectedConvertedB, startDateB, endDateB]);

    const isOverCap = filteredCalls.length > 250 || (mode === 'compare' && filteredCallsB.length > 250);
    const isEmpty = filteredCalls.length === 0 || (mode === 'compare' && filteredCallsB.length === 0);

    const buildSegmentDesc = (f) => {
        const parts = [];
        if (f.cities?.length) parts.push(`Cities: ${f.cities.join(', ')}`);
        if (f.stores?.length) parts.push(`Stores: ${f.stores.join(', ')}`);
        if (f.callTypes?.length) parts.push(`Call Types: ${f.callTypes.join(', ')}`);
        if (f.intents?.length) parts.push(`Purchase Intent: ${f.intents.join(', ')}`);
        if (f.visits?.length) parts.push(`Visit Intent: ${f.visits.join(', ')}`);
        if (f.experiences?.length) parts.push(`Experience: ${f.experiences.join(', ')}`);
        if (f.agentNps?.length) parts.push(`Agent NPS: ${f.agentNps.join(', ')}`);
        if (f.brandNps?.length) parts.push(`Brand NPS: ${f.brandNps.join(', ')}`);
        if (f.categories?.length) parts.push(`Categories: ${f.categories.join(', ')}`);
        if (f.funnels?.length) parts.push(`Funnel: ${f.funnels.join(', ')}`);
        if (f.prices?.length) parts.push(`Price Bucket: ${f.prices.join(', ')}`);
        if (f.barriers?.length) parts.push(`Barriers: ${f.barriers.join(', ')}`);
        if (f.converted?.length) parts.push(`Converted: ${f.converted.join(', ')}`);
        return parts.length ? parts.join(' | ') : 'All segments (no filters applied)';
    };

    const segmentA = {
        cities: selectedCities, stores: selectedStores, callTypes: selectedCallTypes,
        intents: selectedIntents, visits: selectedVisits, experiences: selectedExperiences,
        agentNps: selectedAgentNps, brandNps: selectedBrandNps, categories: selectedCategories,
        funnels: selectedFunnels, prices: selectedPrices, barriers: selectedBarriers, converted: selectedConverted,
    };
    const segmentB = {
        cities: selectedCitiesB, stores: selectedStoresB, callTypes: selectedCallTypesB,
        intents: selectedIntentsB, visits: selectedVisitsB, experiences: selectedExperiencesB,
        agentNps: selectedAgentNpsB, brandNps: selectedBrandNpsB, categories: selectedCategoriesB,
        funnels: selectedFunnelsB, prices: selectedPricesB, barriers: selectedBarriersB, converted: selectedConvertedB,
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
        const descA = buildSegmentDesc(segmentA);
        const dateA = buildDateRange(startDate, endDate);

        let cleanNumbersB = null;
        let descB = null;
        let dateB = null;

        if (mode === 'compare') {
            cleanNumbersB = filteredCallsB.map(r => r.clean_number);
            descB = buildSegmentDesc(segmentB);
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
                    <div className="flex items-center gap-3">
                        {/* SWOT Reports CTA — opens the city + store SWOT view (synced with the AI Trainer) */}
                        <button
                            onClick={() => navigate('/swot-reports')}
                            className="bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2 shadow-sm"
                            title="Open the SWOT Reports view (city + store, with phone-citation links)"
                        >
                            <BarChart3 className="w-4 h-4" /> SWOT Reports
                        </button>

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
                </div>

                {/* Filter Panel A */}
                <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-xl shadow-slate-200/50 mb-6 print:hidden relative">
                    {mode === 'compare' && (
                        <div className="absolute -top-3 left-8 bg-amber-100 text-amber-700 px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border border-amber-200">
                            Dataset A
                        </div>
                    )}
                    <div className="flex flex-wrap gap-4 items-end pt-2">

                        <FilterDropdown label="City" icon={<MapPin className="w-4 h-4 text-emerald-500" />}
                            options={filterOptions.cities} selected={selectedCities} setSelected={setSelectedCities} />

                        <FilterDropdown label="Store" icon={<Building2 className="w-4 h-4 text-indigo-500" />}
                            options={availableStores} selected={selectedStores} setSelected={setSelectedStores} />

                        <FilterDropdown label="Call Type" icon={<Phone className="w-4 h-4 text-slate-500" />}
                            options={filterOptions.callTypes} selected={selectedCallTypes} setSelected={setSelectedCallTypes} />

                        <FilterDropdown label="Purchase Intent" icon={<Target className="w-4 h-4 text-rose-500" />}
                            options={RATING_OPTIONS} selected={selectedIntents} setSelected={setSelectedIntents} />

                        <FilterDropdown label="Visit Intent" icon={<Footprints className="w-4 h-4 text-amber-500" />}
                            options={RATING_OPTIONS} selected={selectedVisits} setSelected={setSelectedVisits} />

                        <FilterDropdown label="Experience" icon={<Star className="w-4 h-4 text-yellow-500" />}
                            options={RATING_OPTIONS} selected={selectedExperiences} setSelected={setSelectedExperiences} />

                        <FilterDropdown label="Agent NPS" icon={<Users className="w-4 h-4 text-violet-500" />}
                            options={RATING_OPTIONS} selected={selectedAgentNps} setSelected={setSelectedAgentNps} />

                        <FilterDropdown label="Brand NPS" icon={<Award className="w-4 h-4 text-fuchsia-500" />}
                            options={RATING_OPTIONS} selected={selectedBrandNps} setSelected={setSelectedBrandNps} />

                        <FilterDropdown label="Category" icon={<ShoppingCart className="w-4 h-4 text-sky-500" />}
                            options={filterOptions.categories} selected={selectedCategories} setSelected={setSelectedCategories} />

                        <FilterDropdown label="Funnel Stage" icon={<Activity className="w-4 h-4 text-cyan-500" />}
                            options={filterOptions.funnels} selected={selectedFunnels} setSelected={setSelectedFunnels} />

                        <FilterDropdown label="Price Bucket" icon={<DollarSign className="w-4 h-4 text-emerald-600" />}
                            options={filterOptions.prices} selected={selectedPrices} setSelected={setSelectedPrices} />

                        <FilterDropdown label="Purchase Barrier" icon={<TrendingDown className="w-4 h-4 text-rose-500" />}
                            options={filterOptions.barriers} selected={selectedBarriers} setSelected={setSelectedBarriers} />

                        <FilterDropdown label="Converted" icon={<CheckCircle className="w-4 h-4 text-emerald-500" />}
                            options={CONVERTED_OPTIONS} selected={selectedConverted} setSelected={setSelectedConverted} />

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

                        {/* Reset — restores all filters to defaults (Call Type → PRE_PURCHASE pair) */}
                        <button
                            onClick={() => {
                                setSelectedCities([]);
                                setSelectedStores([]);
                                setSelectedCallTypes(DEFAULT_CALL_TYPES);
                                setSelectedIntents([]);
                                setSelectedVisits([]);
                                setSelectedExperiences([]);
                                setSelectedAgentNps([]);
                                setSelectedBrandNps([]);
                                setSelectedCategories([]);
                                setSelectedFunnels([]);
                                setSelectedPrices([]);
                                setSelectedBarriers([]);
                                setSelectedConverted([]);
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

                            <FilterDropdown label="City" icon={<MapPin className="w-4 h-4 text-emerald-500" />}
                                options={filterOptions.cities} selected={selectedCitiesB} setSelected={setSelectedCitiesB} />

                            <FilterDropdown label="Store" icon={<Building2 className="w-4 h-4 text-indigo-500" />}
                                options={availableStoresB} selected={selectedStoresB} setSelected={setSelectedStoresB} />

                            <FilterDropdown label="Call Type" icon={<Phone className="w-4 h-4 text-slate-500" />}
                                options={filterOptions.callTypes} selected={selectedCallTypesB} setSelected={setSelectedCallTypesB} />

                            <FilterDropdown label="Purchase Intent" icon={<Target className="w-4 h-4 text-rose-500" />}
                                options={RATING_OPTIONS} selected={selectedIntentsB} setSelected={setSelectedIntentsB} />

                            <FilterDropdown label="Visit Intent" icon={<Footprints className="w-4 h-4 text-amber-500" />}
                                options={RATING_OPTIONS} selected={selectedVisitsB} setSelected={setSelectedVisitsB} />

                            <FilterDropdown label="Experience" icon={<Star className="w-4 h-4 text-yellow-500" />}
                                options={RATING_OPTIONS} selected={selectedExperiencesB} setSelected={setSelectedExperiencesB} />

                            <FilterDropdown label="Agent NPS" icon={<Users className="w-4 h-4 text-violet-500" />}
                                options={RATING_OPTIONS} selected={selectedAgentNpsB} setSelected={setSelectedAgentNpsB} />

                            <FilterDropdown label="Brand NPS" icon={<Award className="w-4 h-4 text-fuchsia-500" />}
                                options={RATING_OPTIONS} selected={selectedBrandNpsB} setSelected={setSelectedBrandNpsB} />

                            <FilterDropdown label="Category" icon={<ShoppingCart className="w-4 h-4 text-sky-500" />}
                                options={filterOptions.categories} selected={selectedCategoriesB} setSelected={setSelectedCategoriesB} />

                            <FilterDropdown label="Funnel Stage" icon={<Activity className="w-4 h-4 text-cyan-500" />}
                                options={filterOptions.funnels} selected={selectedFunnelsB} setSelected={setSelectedFunnelsB} />

                            <FilterDropdown label="Price Bucket" icon={<DollarSign className="w-4 h-4 text-emerald-600" />}
                                options={filterOptions.prices} selected={selectedPricesB} setSelected={setSelectedPricesB} />

                            <FilterDropdown label="Purchase Barrier" icon={<TrendingDown className="w-4 h-4 text-rose-500" />}
                                options={filterOptions.barriers} selected={selectedBarriersB} setSelected={setSelectedBarriersB} />

                            <FilterDropdown label="Converted" icon={<CheckCircle className="w-4 h-4 text-emerald-500" />}
                                options={CONVERTED_OPTIONS} selected={selectedConvertedB} setSelected={setSelectedConvertedB} />

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

                            {/* Reset — restores all filters to defaults (Call Type → PRE_PURCHASE pair) */}
                            <button
                                onClick={() => {
                                    setSelectedCitiesB([]);
                                    setSelectedStoresB([]);
                                    setSelectedCallTypesB(DEFAULT_CALL_TYPES);
                                    setSelectedIntentsB([]);
                                    setSelectedVisitsB([]);
                                    setSelectedExperiencesB([]);
                                    setSelectedAgentNpsB([]);
                                    setSelectedBrandNpsB([]);
                                    setSelectedCategoriesB([]);
                                    setSelectedFunnelsB([]);
                                    setSelectedPricesB([]);
                                    setSelectedBarriersB([]);
                                    setSelectedConvertedB([]);
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
                                <span className={`text-3xl font-black leading-none mt-1 ${filteredCalls.length > 250 ? 'text-red-500' : 'text-amber-600'}`}>
                                    {filteredCalls.length}
                                </span>
                            </div>
                            {mode === 'compare' && (
                                <div className="flex flex-col border-r border-slate-100 pr-6">
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Set B Calls</span>
                                    <span className={`text-3xl font-black leading-none mt-1 ${filteredCallsB.length > 250 ? 'text-red-500' : 'text-indigo-600'}`}>
                                        {filteredCallsB.length}
                                    </span>
                                </div>
                            )}
                            
                            {isOverCap && (
                                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2 text-red-600 animate-pulse">
                                    <AlertTriangle className="w-4 h-4" />
                                    <span className="text-xs font-bold">Sorry, maximum 250 calls allowed per dataset. Please narrow down your search.</span>
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
                                        <>Set A: {buildSegmentDesc(segmentA)} | {buildDateRange(startDate, endDate)} ({filteredCalls.length} calls) <br/>
                                        Set B: {buildSegmentDesc(segmentB)} | {buildDateRange(startDateB, endDateB)} ({filteredCallsB.length} calls)</>
                                    ) : (
                                        <>{buildSegmentDesc(segmentA)} · {buildDateRange(startDate, endDate)} · {filteredCalls.length} calls analysed</>
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
                                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                                    <h4 className="font-black text-slate-800 text-sm">{item.title}</h4>
                                                    {item.call_percentage && (
                                                        <span className="text-[10px] font-bold text-sky-600 bg-sky-50 border border-sky-100 px-2 py-0.5 rounded-full">
                                                            Targets {item.call_percentage}{item.call_count != null ? ` (${item.call_count} calls)` : ''}
                                                        </span>
                                                    )}
                                                    {item.dataset_a?.call_percentage && (
                                                        <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full">
                                                            A: {item.dataset_a.call_percentage}
                                                        </span>
                                                    )}
                                                    {item.dataset_b?.call_percentage && (
                                                        <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full">
                                                            B: {item.dataset_b.call_percentage}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-slate-500 text-sm leading-relaxed">{item.detail}</p>
                                                {item.addresses_themes?.length > 0 && (
                                                    <p className="text-[11px] text-slate-400 italic mt-1">
                                                        Addresses: {item.addresses_themes.join('; ')}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Custom Answer Card — long-form first-principles analysis */}
                        {report.custom_answer && (
                            <CustomAnswerCard answer={report.custom_answer} fallbackQuestion={customQuestion} />
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
                            <InsightItem key={idx} idx={idx} item={item} tone="good" />
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
                            <InsightItem key={idx} idx={idx} item={item} tone="bad" />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

// Renders a single Top-N insight bullet. Handles both shapes:
//   single-segment: { title, detail, call_count, call_percentage, example_clean_numbers }
//   comparison:     { title, detail, dataset_a:{...}, dataset_b:{...} }
function InsightItem({ idx, item, tone }) {
    const numStyle = tone === 'good'
        ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
        : 'bg-rose-50 border-rose-200 text-rose-600';
    const isCompare = item.dataset_a || item.dataset_b;

    return (
        <div className="flex gap-3 items-start">
            <div className={`flex-shrink-0 w-7 h-7 ${numStyle} border rounded-lg flex items-center justify-center font-black text-xs`}>
                {idx + 1}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h4 className="font-black text-slate-800 text-sm">{item.title}</h4>
                    {!isCompare && item.call_percentage && (
                        <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                            {item.call_percentage} of calls{item.call_count != null ? ` (${item.call_count})` : ''}
                        </span>
                    )}
                </div>
                <p className="text-slate-500 text-xs leading-relaxed">{item.detail}</p>

                {/* Single-segment phone number examples */}
                {!isCompare && item.example_clean_numbers?.length > 0 && (
                    <CleanNumberList numbers={item.example_clean_numbers} />
                )}

                {/* Comparison: Dataset A vs Dataset B sub-blocks */}
                {isCompare && (
                    <div className="mt-3 grid grid-cols-2 gap-3">
                        <DatasetBlock label="Dataset A" data={item.dataset_a} accent="amber" />
                        <DatasetBlock label="Dataset B" data={item.dataset_b} accent="indigo" />
                    </div>
                )}
            </div>
        </div>
    );
}

function DatasetBlock({ label, data, accent }) {
    if (!data) return null;
    const accentClass = accent === 'amber'
        ? 'text-amber-600 bg-amber-50 border-amber-100'
        : 'text-indigo-600 bg-indigo-50 border-indigo-100';
    return (
        <div className="bg-slate-50/50 border border-slate-100 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{label}</span>
                {data.call_percentage && (
                    <span className={`text-[10px] font-bold ${accentClass} border px-2 py-0.5 rounded-full`}>
                        {data.call_percentage}{data.call_count != null ? ` (${data.call_count})` : ''}
                    </span>
                )}
            </div>
            {data.example_clean_numbers?.length > 0 && (
                <CleanNumberList numbers={data.example_clean_numbers} compact />
            )}
        </div>
    );
}

function CleanNumberList({ numbers, compact }) {
    if (!numbers || numbers.length === 0) return null;
    return (
        <div className={`mt-2 flex flex-wrap gap-1.5 ${compact ? '' : 'items-center'}`}>
            {!compact && (
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mr-1">Examples:</span>
            )}
            {numbers.map(n => (
                <Link
                    key={n}
                    to={`/call/${n}`}
                    className="text-[10px] font-mono font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-100 px-2 py-0.5 rounded transition-colors"
                    title={`Open call ${n}`}
                >
                    {n}
                </Link>
            ))}
        </div>
    );
}

// Renders the deep custom-answer block: question, multi-paragraph first-principles
// analysis, supporting evidence (per dataset in compare mode), and conclusion.
function CustomAnswerCard({ answer, fallbackQuestion }) {
    const isCompare = answer.dataset_a_evidence || answer.dataset_b_evidence;
    const paragraphs = (answer.first_principles_analysis || '').split(/\n\n+/).filter(Boolean);

    return (
        <div className="bg-white rounded-[2rem] border border-slate-200 shadow-xl shadow-slate-200/40 overflow-hidden mb-8">
            <div className="p-8 border-b border-slate-100 flex items-center gap-4">
                <div className="p-3 rounded-2xl bg-fuchsia-50 text-fuchsia-600">
                    <Sparkles className="w-5 h-5" />
                </div>
                <div>
                    <h3 className="text-xl font-black text-slate-900" style={{ fontFamily: "'Fraunces', serif" }}>
                        Answer to your Question
                    </h3>
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-0.5">Q: {answer.question || fallbackQuestion}</p>
                </div>
            </div>
            <div className="p-8 space-y-8">
                {/* First Principles Analysis */}
                {paragraphs.length > 0 && (
                    <div>
                        <div className="text-[10px] font-black text-fuchsia-600 uppercase tracking-widest mb-3">First Principles Analysis</div>
                        <div className="space-y-3">
                            {paragraphs.map((p, i) => (
                                <p key={i} className="text-slate-700 text-sm leading-relaxed">{p}</p>
                            ))}
                        </div>
                    </div>
                )}

                {/* Supporting Evidence — single segment */}
                {!isCompare && answer.key_insights?.length > 0 && (
                    <div>
                        <div className="text-[10px] font-black text-fuchsia-600 uppercase tracking-widest mb-3">Supporting Evidence</div>
                        <div className="space-y-4">
                            {answer.key_insights.map((ki, idx) => (
                                <EvidenceItem key={idx} idx={idx} item={ki} />
                            ))}
                        </div>
                    </div>
                )}

                {/* Supporting Evidence — comparison mode (two columns) */}
                {isCompare && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <div className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-3">Dataset A — Evidence</div>
                            <div className="space-y-4">
                                {(answer.dataset_a_evidence || []).map((ki, idx) => (
                                    <EvidenceItem key={idx} idx={idx} item={ki} accent="amber" />
                                ))}
                            </div>
                        </div>
                        <div>
                            <div className="text-[10px] font-black text-indigo-600 uppercase tracking-widest mb-3">Dataset B — Evidence</div>
                            <div className="space-y-4">
                                {(answer.dataset_b_evidence || []).map((ki, idx) => (
                                    <EvidenceItem key={idx} idx={idx} item={ki} accent="indigo" />
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* Conclusion / Synthesis */}
                {(answer.conclusion || answer.comparative_synthesis) && (
                    <div className="bg-fuchsia-50/40 border border-fuchsia-100 rounded-2xl p-6">
                        <div className="text-[10px] font-black text-fuchsia-600 uppercase tracking-widest mb-2">
                            {isCompare ? 'Comparative Synthesis' : 'Conclusion'}
                        </div>
                        <p className="text-slate-700 text-sm leading-relaxed">
                            {answer.comparative_synthesis || answer.conclusion}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}

function EvidenceItem({ idx, item, accent }) {
    const accentClass = accent === 'amber'
        ? 'bg-amber-50 border-amber-200 text-amber-600'
        : accent === 'indigo'
        ? 'bg-indigo-50 border-indigo-200 text-indigo-600'
        : 'bg-fuchsia-50 border-fuchsia-200 text-fuchsia-600';
    return (
        <div className="flex gap-3 items-start">
            <div className={`flex-shrink-0 w-7 h-7 ${accentClass} border rounded-lg flex items-center justify-center font-black text-xs`}>
                {idx + 1}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="font-bold text-slate-800 text-sm">{item.insight || item.title}</p>
                    {item.call_percentage && (
                        <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                            {item.call_percentage}{item.call_count != null ? ` (${item.call_count})` : ''}
                        </span>
                    )}
                </div>
                {item.detail && <p className="text-slate-500 text-xs leading-relaxed">{item.detail}</p>}
                {item.example_clean_numbers?.length > 0 && (
                    <CleanNumberList numbers={item.example_clean_numbers} />
                )}
            </div>
        </div>
    );
}
