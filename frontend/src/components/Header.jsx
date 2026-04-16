import React from 'react';
import { Link } from 'react-router-dom';

export default function Header() {
  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-[1800px] mx-auto px-8 h-20 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3">
          <div className="bg-blue-600 h-10 w-10 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-200">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l2.27-2.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          </div>
          <div>
            <span className="text-xl font-bold text-gray-900 tracking-tight heading-font">DUROFLEX</span>
            <span className="text-xs font-bold text-blue-600 block uppercase tracking-[0.2em] leading-none">Call Analyzer</span>
          </div>
        </Link>
        <div className="flex items-center gap-6">
          <nav className="hidden md:flex items-center gap-1">
            <HeaderLink to="/" label="Dashboard" active />
            <HeaderLink to="/" label="All Calls" />
            <HeaderLink to="/" label="Reports" />
          </nav>
          <div className="h-8 w-px bg-gray-200 mx-2 hidden md:block"></div>
          <button className="flex items-center gap-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-full px-4 py-2 transition shadow-sm">
            <div className="h-6 w-6 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-[10px] font-bold">JD</div>
            <span className="text-sm font-semibold text-gray-700">John Doe</span>
          </button>
        </div>
      </div>
    </header>
  );
}

function HeaderLink({ to, label, active }) {
  return (
    <Link to={to} className={`px-4 py-2 rounded-lg text-sm font-bold transition ${active ? 'text-blue-600 bg-blue-50' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'}`}>
      {label}
    </Link>
  );
}
