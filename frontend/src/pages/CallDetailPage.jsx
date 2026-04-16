import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchCallDetail, formatDuration, formatShortDate } from '../utils/api';
import ScoreBadge from '../components/ScoreBadge';
import YesNoBadge from '../components/YesNoBadge';
import FunnelSteps from '../components/FunnelSteps';
import TranscriptChat from '../components/TranscriptChat';
import SectionCard from '../components/SectionCard';

export default function CallDetailPage() {
  const { cleanNumber } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchCallDetail(cleanNumber)
      .then(setData)
      .catch(() => setError('Call not found'))
      .finally(() => setLoading(false));
  }, [cleanNumber]);

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-gray-500 text-lg animate-pulse">Loading call details...</div>
    </div>
  );
  if (error) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-red-500 text-lg flex flex-col items-center gap-4">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        {error}
        <Link to="/" className="text-blue-600 hover:underline font-bold">Back to Listing</Link>
      </div>
    </div>
  );
  if (!data) return null;

  const { identity: id, customer_metadata: meta, summary_signals: sig, call_objective: obj,
    intent, experience: exp, funnel, product_intelligence: prod, customer_needs: needs,
    barriers, conversion_hooks: hooks, probing, agent_scorecard: agent,
    relax_framework: relax, closing, airboost, transcript, cross_sell, upsell } = data;

  return (
    <div className="min-h-screen bg-gray-50 selection:bg-blue-100">
      <div className="max-w-[1700px] mx-auto px-6 md:px-10 py-10">

        {/* ── Top Navigation ── */}
        <div className="flex items-center justify-between mb-8 flex-wrap gap-6">
          <Link to="/" className="text-sm font-bold text-gray-500 hover:text-blue-600 transition-all tracking-widest flex items-center gap-2 group">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="group-hover:-translate-x-1 transition-transform"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            BACK TO STORE CALLS
          </Link>
          <div className="flex gap-4 items-center flex-wrap justify-end">
            <div className="flex -space-x-px overflow-hidden rounded-lg border border-gray-300 shadow-sm font-mono text-xs">
              <span className="bg-gray-100 px-3 py-2 text-gray-500 border-r border-gray-300">ID</span>
              <span className="bg-white px-3 py-2 text-gray-900 font-bold">CALL-{id.clean_number}</span>
            </div>
            
            <HeaderBadge label="Objective" value={obj.type || 'N/A'} color="blue" />
            
            <div className="flex gap-3 bg-white p-1 rounded-xl border border-gray-200 shadow-sm">
                <HeaderBadge label="Intent" value={<ScoreBadge label={intent.purchase_score} />} plain />
                <HeaderBadge label="Experience" value={<ScoreBadge label={exp.agent.rating} />} plain />
            </div>

            {id.recording_url && (
              <a href={id.recording_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center px-6 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-xl text-sm font-bold transition-all tracking-wide shadow-lg shadow-blue-200 gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                LISTEN TO CALL
              </a>
            )}
          </div>
        </div>

        {/* ── Main Layout Grid ── */}
        <div className="space-y-8">
            
          {/* Header & Basic Stats */}
          <SectionCard variant="white" className="!p-0 border-none shadow-none bg-transparent">
            <div className="bg-white border-2 border-gray-200 rounded-3xl p-8 md:p-10 shadow-xl overflow-hidden relative">
                <div className="absolute top-0 left-0 w-2 h-full bg-blue-500"></div>
                
                <div className="mb-10">
                    <h1 className="text-4xl md:text-5xl font-bold text-gray-900 heading-font leading-tight">Store Call Analysis</h1>
                    <div className="flex items-center gap-3 text-gray-500 mt-4 flex-wrap">
                        <span className="bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest border border-blue-100">GMB Inbound</span>
                        <span className="text-gray-300">•</span>
                        <span className="font-semibold text-gray-700">{id.brand}</span>
                        <span className="text-gray-300">•</span>
                        <span className="font-semibold text-gray-700">{id.store_name}</span>
                        <span className="text-gray-300">•</span>
                        <span className="font-semibold text-gray-700">{id.city}, {id.state}</span>
                    </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
                    {/* Call Snapshot */}
                    <div className="xl:col-span-3 border border-gray-100 rounded-2xl p-6 bg-gray-50/50">
                        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 border-b border-gray-200 pb-2">Store & Call Info</h3>
                        <div className="space-y-4">
                            <InfoField label="Brand" value={id.brand} />
                            <InfoField label="Store Name" value={id.store_name} />
                            <InfoField label="Location" value={[id.locality, id.city, id.state].filter(Boolean).join(', ')} />
                            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-200">
                                <InfoField label="Call Date" value={formatShortDate(id.call_date)} mono />
                                <InfoField label="Duration" value={formatDuration(id.duration)} mono />
                            </div>
                        </div>
                    </div>

                    {/* Customer Profile */}
                    <div className="xl:col-span-3 border border-gray-100 rounded-2xl p-6 bg-gray-50/50">
                        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 border-b border-gray-200 pb-2">Customer Profile</h3>
                        <div className="space-y-4">
                            <InfoField label="Customer Name" value={meta.name} bold />
                            <InfoField label="Language/Gender" value={`${meta.language} • ${meta.gender}`} />
                            <InfoField label="Age/Income" value={`${meta.age_group} • ${meta.income_group}`} />
                            <InfoField label="Persona" value={meta.persona} bold className="text-blue-700" />
                            <InfoField label="Decision Maker" value={meta.decision_maker} />
                        </div>
                    </div>

                    {/* Performance Signals */}
                    <div className="xl:col-span-6 border border-blue-100 rounded-2xl p-6 bg-blue-50/30">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-xs font-bold text-blue-600 uppercase tracking-widest border-b-2 border-blue-200 pb-1">Call Analysis Signals</h3>
                            <div className="flex flex-col items-end">
                                <span className="text-[10px] text-gray-400 font-bold uppercase mb-1">Quality Score</span>
                                <ScoreBadge label={sig.call_quality} />
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-4 mb-6">
                            <StatusTile label="Enthusiasm" value={<ScoreBadge label={sig.enthusiasm} />} />
                            <StatusTile label="Converted" value={<YesNoBadge value={sig.is_converted} />} />
                            <StatusTile label="Revenue" value={<span className="text-xl font-bold text-gray-900">₹{sig.revenue || '0'}</span>} />
                        </div>
                        <div className="bg-white border border-blue-100 rounded-xl p-6 shadow-sm">
                            <span className="text-[10px] font-bold text-blue-700 uppercase tracking-widest block mb-2 opacity-60">Call Summary AI</span>
                            <p className="text-base text-gray-700 leading-relaxed font-medium italic">"{sig.call_summary || 'No summary available.'}"</p>
                        </div>
                    </div>
                </div>
            </div>
          </SectionCard>

          {/* ── Intelligence Grid ── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
            {/* Product Intelligence */}
            <SectionCard title="Product Intelligence" subtitle="Interest & Verbatim" variant="white">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <SmallCard label="Category" value={prod.category} />
                    <SmallCard label="Sub Category" value={prod.sub_category} />
                    <SmallCard label="Collection" value={prod.collection} />
                    <SmallCard label="Narrow Down Stage" value={prod.narrow_down_stage} />
                    <div className="md:col-span-2 bg-blue-50/50 p-4 rounded-xl border border-blue-100">
                        <span className="text-xs text-blue-600 font-bold uppercase tracking-wider block mb-2">Customer Verbatim</span>
                        <p className="text-sm font-semibold text-gray-800 italic">"{prod.verbatim || 'N/A'}"</p>
                    </div>
                </div>
            </SectionCard>

            {/* Customer Needs */}
            <SectionCard title="Customer Needs" subtitle="Voice of Customer" variant="white">
                <div className="bg-gray-50 border border-gray-200 rounded-2xl p-6 h-full flex flex-col justify-center">
                    <p className="text-lg text-gray-700 leading-relaxed font-medium text-center">
                        {needs.description || 'No specific needs described in transcript.'}
                    </p>
                </div>
            </SectionCard>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
            <div className="xl:col-span-5 flex flex-col gap-8">
                {/* Intent */}
                <SectionCard title="Customer Intent" subtitle="Purchase readiness" variant="white" className="flex-1">
                    <div className="space-y-4">
                        <IntentCard title="Intent to Visit Store" rating={intent.visit_rating} reason={intent.visit_reason} />
                        <IntentCard title="Intent to Purchase" rating={intent.purchase_score} reason={intent.purchase_evidence} />
                    </div>
                </SectionCard>
                {/* Barriers */}
                <SectionCard title="Friction & Barriers" subtitle="Why they might drop" variant="red" className="border-red-200">
                    <div className="space-y-4">
                        <BarrierCard title="Purchase Barrier" type={barriers.purchase.type} detail={barriers.purchase.detail} />
                        <BarrierCard title="Store Visit Barrier" type={barriers.store_visit.type} detail={barriers.store_visit.detail} />
                    </div>
                </SectionCard>
            </div>

            <div className="xl:col-span-7 flex flex-col gap-8">
                {/* Funnel */}
                <SectionCard title="Funnel & Timeline" subtitle="Path to action" variant="white">
                    <div className="mb-10 pt-4">
                        <FunnelSteps activeStage={funnel.stage} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-6">
                            <span className="text-xs text-gray-500 font-bold uppercase tracking-widest block mb-2">Stage Logic</span>
                            <p className="text-lg font-bold text-blue-700 mb-2">{funnel.stage || 'N/A'}</p>
                            <p className="text-sm text-gray-600 leading-relaxed">{funnel.reason}</p>
                        </div>
                        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-6">
                            <span className="text-xs text-gray-500 font-bold uppercase tracking-widest block mb-2">Purchase Timeline</span>
                            <p className="text-lg font-bold text-gray-900 mb-2">{funnel.timeline || 'N/A'}</p>
                            <p className="text-sm text-gray-600 leading-relaxed">{funnel.timeline_reason}</p>
                        </div>
                    </div>
                    <div className="mt-6 p-6 bg-blue-600 text-white rounded-2xl shadow-lg flex items-center justify-between">
                        <div>
                            <span className="text-xs font-bold uppercase tracking-widest opacity-80 mb-1 block">Recommended Priority</span>
                            <p className="text-xl font-bold">{funnel.follow_up_priority || 'N/A'}</p>
                        </div>
                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-40"><path d="M12 22l4-4-4-4"/><path d="M4 12V4"/><path d="M4 4l4 4-4-4"/><path d="M20 12v8"/><path d="M20 20l-4-4 4 4"/></svg>
                    </div>
                </SectionCard>
            </div>
          </div>

          {/* Experience */}
          <SectionCard title="Customer Experience" subtitle="Internal metrics" variant="white">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                <ExperienceCard title="Agent Experience" subtitle="Interaction quality"
                nps={exp.agent.nps} rating={exp.agent.rating} reason={exp.agent.reason}
                good={exp.agent.good} bad={exp.agent.bad} />
                <ExperienceCard title="Brand Experience" subtitle="Customer Brand Perception"
                nps={exp.brand.nps} rating={exp.brand.rating} reason={exp.brand.reason}
                good={exp.brand.good} bad={exp.brand.bad} goodLabel="Positive signal" badLabel="Brand friction" />
            </div>
          </SectionCard>

          {/* Hooks */}
          <SectionCard title="Conversion Hooks Utilization" subtitle="Sales Framework" variant="white">
            <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-5">
                <HookCard title="Store Visit" used={hooks.store_visit.used} evidence={hooks.store_visit.evidence} />
                <HookCard title="WhatsApp" used={hooks.whatsapp.used} evidence={hooks.whatsapp.evidence} />
                <HookCard title="Video Demo" used={hooks.video_demo.used} evidence={hooks.video_demo.evidence} />
                <HookCard title="Measurement" used={hooks.measurement.used} evidence={hooks.measurement.evidence} />
                <HookCard title="Offers/EMI" used={hooks.offers.used} evidence={hooks.offers.evidence} />
            </div>
            {(hooks.missed_hook_1 || hooks.missed_hook_2) && (
                <div className="mt-8 bg-amber-50 border border-amber-200 rounded-2xl p-6 flex gap-4 items-start">
                    <div className="bg-amber-100 p-2 rounded-lg text-amber-700">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    </div>
                    <div>
                        <p className="text-sm font-bold text-amber-800 uppercase tracking-widest mb-3">Relevant hooks missed by agent</p>
                        <div className="space-y-3">
                            {hooks.missed_hook_1 && <div className="text-sm text-gray-700"><span className="font-bold text-amber-900 bg-amber-100 px-2 py-0.5 rounded mr-2">{hooks.missed_hook_1}</span> {hooks.missed_hook_1_reason}</div>}
                            {hooks.missed_hook_2 && <div className="text-sm text-gray-700"><span className="font-bold text-amber-900 bg-amber-100 px-2 py-0.5 rounded mr-2">{hooks.missed_hook_2}</span> {hooks.missed_hook_2_reason}</div>}
                        </div>
                    </div>
                </div>
            )}
          </SectionCard>

          {/* Probing */}
          <SectionCard title="Probing & Discovery Quality" subtitle="Information gathering" variant="white">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-6">
                <ProbingCard title="Why Buying" data={probing.why_buying} icon="?" />
                <ProbingCard title="Whom For" data={probing.whom_for} icon="👥" />
                <ProbingCard title="Visit Intent" data={probing.visit_intent} icon="📍" />
                <ProbingCard title="Current Product" data={probing.current_product} icon="🛏️" />
                <ProbingCard title="Budget Explored" data={probing.budget} icon="💰" />
            </div>
          </SectionCard>

          {/* Agent Deep Dive */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
            <SectionCard title="Agent Score Card" subtitle="Skills assessment" variant="white">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <AgentRow label="Nature" value={agent.nature} reason={agent.nature_reason} isText />
                    <AgentRow label="Footfall Skills" value={agent.footfall_driving} reason={agent.footfall_driving_reason} />
                    <AgentRow label="Objection Handling" value={agent.objection_handling} reason={agent.objection_handling_reason} />
                    <AgentRow label="Explanation Quality" value={agent.explanation_quality} reason={agent.explanation_quality_reason} />
                </div>
                {agent.learnings && (
                    <div className="mt-6 bg-blue-50 border border-blue-100 rounded-2xl p-6">
                        <span className="text-[10px] font-bold text-blue-700 uppercase tracking-widest block mb-4 border-b border-blue-200 pb-2">Coach's Learnings & Feedback</span>
                        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line font-medium leading-[1.6]">{agent.learnings}</p>
                    </div>
                )}
            </SectionCard>

            <SectionCard title="RELAX Framework" subtitle="Step-by-step performance" variant="white">
                <div className="space-y-4">
                    <AgentRow label="R — Reach Out" value={relax.reach_out.score} reason={relax.reach_out.reason} />
                    <AgentRow label="E — Explore Needs" value={relax.explore_needs.score} reason={relax.explore_needs.reason} />
                    <AgentRow label="L — Link Product" value={relax.link_product.score} reason={relax.link_product.reason} />
                    <AgentRow label="A — Add Value" value={relax.add_value.score} reason={relax.add_value.reason} />
                    <AgentRow label="X — Xpress Closing" value={relax.express_closing.score} reason={relax.express_closing.reason} />
                </div>
            </SectionCard>
          </div>

          {/* Follow-ups & Airboost */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
            <div className="xl:col-span-12">
               <SectionCard title="Next Actions & Airboost" subtitle="Closing intelligence" variant="blue">
                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                        <div className="xl:col-span-1">
                            <h4 className="text-sm font-bold text-blue-800 uppercase mb-4 tracking-widest">Recommended Actions</h4>
                            <div className="bg-white border-2 border-blue-200 rounded-2xl p-6 shadow-sm min-h-[150px] flex items-center justify-center">
                                <p className="text-lg text-gray-800 font-bold leading-relaxed text-center">{closing.next_actions || 'N/A'}</p>
                            </div>
                        </div>
                        <div className="xl:col-span-2">
                             <h4 className="text-sm font-bold text-blue-800 uppercase mb-4 tracking-widest">Airboost Program Tracking</h4>
                             <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                                <StatusCard label="Agent Ment." value={airboost.agent_mentioned} />
                                <StatusCard label="Cust. Ment." value={airboost.customer_mentioned} />
                                <StatusCard label="Upsell Possible" value={airboost.upsell_possible} />
                                <StatusCard label="Upsell Att." value={airboost.upsell_attempted} />
                                <StatusCard label="Score" value={airboost.attempt_score} isValue />
                             </div>
                        </div>
                    </div>
               </SectionCard>
            </div>
          </div>

          {/* Transcript */}
          <SectionCard title="Full Call Transcript" subtitle="RAW CONVERSATION LOG" variant="white" className="!p-0">
             <div className="bg-white border-none rounded-none">
                <TranscriptChat messages={transcript} />
             </div>
          </SectionCard>

          {/* Footer */}
          <footer className="text-center pt-12 pb-8 border-t border-gray-200 mt-10">
            <div className="inline-flex items-center gap-2 px-6 py-2 bg-white rounded-full border border-gray-200 shadow-sm text-gray-500 font-bold text-xs uppercase tracking-widest mb-4">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                Duroflex Store Intelligence Engine
            </div>
            <p className="text-sm text-gray-400">© 2026 Duroflex Analytics • Confidential Data</p>
          </footer>
        </div>
      </div>
    </div>
  );
}

/* ── Refactored Sub-components ── */

function HeaderBadge({ label, value, color, plain }) {
    if (plain) return (
        <div className="flex flex-col items-center px-4 py-2">
            <span className="text-[10px] text-gray-400 font-bold uppercase mb-1">{label}</span>
            {value}
        </div>
    );
    const colors = {
        blue: "bg-blue-50 text-blue-700 border-blue-200",
        gray: "bg-white text-gray-600 border-gray-300",
    };
    return (
        <span className={`inline-flex items-center px-5 py-2.5 rounded-xl text-sm border shadow-sm ${colors[color] || colors.gray}`}>
            <span className="font-semibold">{label}:&nbsp;</span>{value}
        </span>
    );
}

function InfoField({ label, value, mono, bold, className = "" }) {
  return (
    <div className={className}>
      <span className="text-[10px] text-gray-400 uppercase tracking-widest font-bold block mb-0.5">{label}</span>
      <span className={`text-sm ${bold ? 'font-bold' : 'font-semibold'} text-gray-900 ${mono ? 'font-mono' : ''}`}>
        {value || 'N/A'}
      </span>
    </div>
  );
}

function StatusTile({ label, value }) {
    return (
        <div className="bg-white border border-blue-50 rounded-xl p-4 shadow-sm flex flex-col items-center justify-center text-center">
            <span className="text-[10px] text-blue-400 font-bold uppercase mb-2 tracking-widest">{label}</span>
            <div className="flex items-center justify-center">{value}</div>
        </div>
    );
}

function StatusCard({ label, value, isValue }) {
    return (
        <div className="bg-white border border-blue-100 rounded-xl p-4 flex flex-col items-center justify-center text-center shadow-sm">
            <span className="text-[9px] text-blue-600 font-bold uppercase mb-2 opacity-60 leading-tight">{label}</span>
            {isValue ? (
                <span className="text-sm font-bold text-gray-900">{value || 'N/A'}</span>
            ) : (
                <YesNoBadge value={value} size="sm" />
            )}
        </div>
    );
}

function SmallCard({ label, value }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 hover:border-blue-300 transition-colors shadow-sm">
      <span className="text-[10px] text-gray-400 uppercase tracking-widest font-bold block mb-1">{label}</span>
      <span className="text-sm text-gray-900 font-bold">{value || 'N/A'}</span>
    </div>
  );
}

function IntentCard({ title, rating, reason }) {
  return (
    <div className="bg-gray-50/50 border border-gray-200 rounded-2xl p-5 hover:bg-white transition-all shadow-sm">
      <div className="flex items-center justify-between gap-4 mb-3">
        <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">{title}</p>
        <ScoreBadge label={rating} />
      </div>
      <p className="text-sm text-gray-700 leading-relaxed font-medium italic">"{reason}"</p>
    </div>
  );
}

function BarrierCard({ title, type, detail }) {
  return (
    <div className="bg-white border border-red-100 rounded-2xl p-5 shadow-sm hover:translate-x-1 transition-transform">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-2 w-2 rounded-full bg-red-500"></div>
        <p className="text-xs text-red-600 font-bold uppercase tracking-widest">{title}</p>
      </div>
      <p className="text-base font-bold text-gray-900 mb-1">{type || 'None'}</p>
      <p className="text-sm text-gray-600 leading-relaxed">{detail}</p>
    </div>
  );
}

function ExperienceCard({ title, subtitle, nps, rating, reason, good, bad, goodLabel = 'What went well', badLabel = 'What was missed' }) {
  return (
    <div className="bg-gray-50/50 border border-gray-200 rounded-2xl p-8 hover:bg-white transition-all shadow-sm">
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <p className="text-[10px] text-blue-600 font-bold uppercase tracking-widest mb-1">{title}</p>
          <h3 className="text-xl font-bold text-gray-900">{subtitle}</h3>
        </div>
        <div className="text-right flex flex-col items-end">
          <ScoreBadge label={rating} />
          <div className="mt-3 flex items-center gap-2 px-3 py-1 bg-white rounded-full border border-gray-200">
             <span className="text-[10px] text-gray-400 font-bold">NPS:</span>
             <span className="text-sm font-bold text-gray-900">{nps}</span>
          </div>
        </div>
      </div>
      
      <div className="bg-white border border-gray-100 rounded-xl p-6 mb-8 shadow-inner">
          <p className="text-sm text-gray-700 leading-relaxed italic font-medium">"{reason}"</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="relative group">
          <div className="absolute -left-2 top-0 h-full w-1 bg-green-500 rounded-full group-hover:w-2 transition-all"></div>
          <p className="text-[10px] text-green-700 font-bold uppercase tracking-widest mb-2 pl-2">{goodLabel}</p>
          <p className="text-sm text-gray-700 bg-green-50/50 p-4 rounded-xl border border-green-100 min-h-[80px]">{good || 'N/A'}</p>
        </div>
        <div className="relative group">
          <div className="absolute -left-2 top-0 h-full w-1 bg-red-500 rounded-full group-hover:w-2 transition-all"></div>
          <p className="text-[10px] text-red-700 font-bold uppercase tracking-widest mb-2 pl-2">{badLabel}</p>
          <p className="text-sm text-gray-700 bg-red-50/50 p-4 rounded-xl border border-red-100 min-h-[80px]">{bad || 'N/A'}</p>
        </div>
      </div>
    </div>
  );
}

function HookCard({ title, used, evidence }) {
  return (
    <div className="bg-gray-50/50 border border-gray-200 rounded-2xl p-5 flex flex-col items-center text-center hover:bg-white transition-all shadow-sm group">
      <div className="mb-4">
          <YesNoBadge value={used} />
      </div>
      <p className="text-xs font-bold text-gray-900 uppercase tracking-widest mb-3 border-b-2 border-transparent group-hover:border-blue-500 transition-all">{title}</p>
      <p className="text-xs text-gray-500 line-clamp-4 group-hover:line-clamp-none transition-all cursor-help" title={evidence}>{evidence || '—'}</p>
    </div>
  );
}

function ProbingCard({ title, data, icon }) {
  const scoreColors = {
      HIGH: "bg-green-100 text-green-700",
      MEDIUM: "bg-amber-100 text-amber-700",
      LOW: "bg-red-100 text-red-700",
  };
  return (
    <div className="bg-white border-2 border-gray-100 rounded-2xl p-6 hover:shadow-md hover:border-blue-200 transition-all">
      <div className="flex items-center justify-between mb-4">
        <span className="text-2xl">{icon}</span>
        <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${scoreColors[data.score] || 'bg-gray-100 text-gray-500'}`}>
            {data.score}
        </div>
      </div>
      <p className="text-xs font-bold text-gray-900 uppercase tracking-widest mb-2">{title}</p>
      <div className="flex items-center gap-1.5 mb-3">
          <span className="text-[9px] font-bold text-gray-400 uppercase">Asked:</span>
          <span className={`text-[10px] font-bold ${data.asked === 'YES' ? 'text-green-600' : 'text-red-600'}`}>
              {data.asked || 'N/A'}
          </span>
      </div>
      <p className="text-xs text-gray-500 leading-relaxed line-clamp-3 italic">"{data.reason || data.detail || 'N/A'}"</p>
    </div>
  );
}

function AgentRow({ label, value, reason, isText }) {
  return (
    <div className="bg-gray-50/50 border border-gray-200 rounded-2xl p-5 hover:bg-white transition-all shadow-sm">
      <div className="flex justify-between items-center gap-4 mb-3">
        <p className="text-sm font-bold text-gray-900 uppercase tracking-widest">{label}</p>
        {isText ? (
          <span className="px-3 py-1 bg-white border border-gray-200 rounded-full text-xs font-bold text-gray-600 shadow-sm">{value || 'N/A'}</span>
        ) : (
          <ScoreBadge label={value} className="text-xs" />
        )}
      </div>
      <p className="text-xs text-gray-600 leading-relaxed bg-white/50 p-3 rounded-lg border border-gray-100 italic">"{reason}"</p>
    </div>
  );
}
