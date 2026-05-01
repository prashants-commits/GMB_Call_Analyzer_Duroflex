import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/Header';
import { trainer, TrainerHTTPError } from '../../utils/trainerApi';

// Identify page: pick city → store → staff → bind a signed cookie.
// We don't fetch the staff list directly (no public endpoint for it yet); for
// now the user types their staff_id. A future task replaces this with a roster
// dropdown after C-group ships.

export default function TrainerIdentify() {
  const navigate = useNavigate();
  const [cities, setCities] = useState({});
  const [city, setCity] = useState('');
  const [storeName, setStoreName] = useState('');
  const [staffList, setStaffList] = useState(null); // null = not loaded; [] = loaded but empty
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffId, setStaffId] = useState('');
  const [email, setEmail] = useState(() => localStorage.getItem('userEmail') || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    trainer.cities()
      .then(setCities)
      .catch((err) => setError(`Could not load cities: ${err.message}`));
  }, []);

  useEffect(() => {
    if (!storeName) {
      setStaffList(null);
      setStaffId('');
      return;
    }
    let cancelled = false;
    setStaffLoading(true);
    trainer.staffInStore(storeName)
      .then((res) => { if (!cancelled) setStaffList(res.staff || []); })
      .catch(() => { if (!cancelled) setStaffList([]); })
      .finally(() => { if (!cancelled) setStaffLoading(false); });
    return () => { cancelled = true; };
  }, [storeName]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await trainer.login(staffId.trim(), email.trim());
      if (res?.actor?.store_name && storeName && res.actor.store_name !== storeName) {
        // Roster says this staff belongs to a different store; warn but still
        // proceed since the roster is authoritative.
        console.warn(`Roster has staff at ${res.actor.store_name}; you picked ${storeName}`);
      }
      navigate('/trainer', { replace: true });
    } catch (err) {
      if (err instanceof TrainerHTTPError) {
        setError(err.detail || err.message);
      } else {
        setError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const cityList = Object.keys(cities).sort();
  const storesForCity = city ? cities[city] || [] : [];

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="max-w-[600px] mx-auto px-8 py-12">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <h1 className="text-2xl font-bold text-gray-900 heading-font">Who are you?</h1>
          <p className="text-gray-500 mt-2 mb-6">
            Pick your store and enter your staff ID to start a trainer session.
          </p>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 mb-4">
              {String(error)}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="City">
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                value={city}
                onChange={(e) => { setCity(e.target.value); setStoreName(''); }}
              >
                <option value="">Select a city…</option>
                {cityList.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>

            <Field label="Store">
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                disabled={!city}
              >
                <option value="">Select a store…</option>
                {storesForCity.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>

            <Field label="Staff">
              {!storeName ? (
                <div className="text-sm text-gray-400 italic px-3 py-2 border border-dashed border-gray-200 rounded-lg">
                  Pick a store first
                </div>
              ) : staffLoading ? (
                <div className="text-sm text-gray-500 px-3 py-2">Loading staff…</div>
              ) : staffList && staffList.length === 0 ? (
                <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  No staff registered for this store yet. Ask your admin to upload the roster.
                </div>
              ) : (
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  value={staffId}
                  onChange={(e) => setStaffId(e.target.value)}
                  required
                >
                  <option value="">Select your name…</option>
                  {(staffList || []).map((s) => (
                    <option key={s.staff_id} value={s.staff_id}>
                      {s.full_name} — {s.role} ({s.staff_id})
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <Field label="Email (optional — needed for admin)">
              <input
                type="email"
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                placeholder="you@duroflexworld.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>

            <button
              type="submit"
              disabled={!staffId.trim() || submitting}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition"
            >
              {submitting ? 'Signing in…' : 'Continue'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-sm font-semibold text-gray-700 mb-1">{label}</span>
      {children}
    </label>
  );
}
