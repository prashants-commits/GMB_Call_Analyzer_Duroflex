import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import Header from '../../components/Header';
import { trainer, TrainerHTTPError } from '../../utils/trainerApi';

export default function TrainerAdmin() {
  const navigate = useNavigate();
  const [actor, setActor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  const [roster, setRoster] = useState(null);
  const [coverage, setCoverage] = useState(null);
  const [auditRows, setAuditRows] = useState([]);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [uploadError, setUploadError] = useState(null);

  useEffect(() => {
    trainer.me()
      .then((data) => {
        if (data.actor.role !== 'admin') {
          setDenied(true);
        } else {
          setActor(data.actor);
        }
      })
      .catch((err) => {
        if (err instanceof TrainerHTTPError && err.status === 401) {
          navigate('/trainer/identify', { replace: true });
        } else {
          setDenied(true);
        }
      })
      .finally(() => setLoading(false));
  }, [navigate]);

  useEffect(() => {
    if (!actor) return;
    refresh();
  }, [actor]);

  async function refresh() {
    const [r, c, a] = await Promise.allSettled([
      trainer.admin.getRoster(),
      trainer.admin.coverage(),
      trainer.admin.audit(50),
    ]);
    if (r.status === 'fulfilled') setRoster(r.value);
    if (c.status === 'fulfilled') setCoverage(c.value);
    if (a.status === 'fulfilled') setAuditRows(a.value.rows || []);
  }

  async function handleUpload(e) {
    e.preventDefault();
    setUploadStatus(null);
    setUploadError(null);
    const file = e.target.elements.csvfile.files[0];
    if (!file) return;
    try {
      const res = await trainer.admin.uploadRoster(file);
      setUploadStatus(`Uploaded ${res.row_count} rows (${res.warning_count} warnings).`);
      await refresh();
    } catch (err) {
      const detail = err instanceof TrainerHTTPError ? err.detail : err.message;
      setUploadError(detail);
    }
  }

  if (loading) return <Shell><div className="text-gray-500">Loading…</div></Shell>;
  if (denied) {
    return (
      <Shell>
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-700">
          You need admin role to view this page.
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="space-y-6">
        <Section title="Persona Library">
          <p className="text-sm text-slate-500 mb-3">
            Manage the persona library that powers mock-call drills (Group D).
            Generate from your call corpus, review the draft, then publish to make it live.
          </p>
          <Link
            to="/trainer/admin/personas"
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold px-4 py-2 rounded-xl transition"
          >
            Open Persona Library →
          </Link>
        </Section>

        <Section title="Roster — upload">
          <form onSubmit={handleUpload} className="flex items-center gap-3">
            <input type="file" name="csvfile" accept=".csv" required className="text-sm" />
            <button className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg">
              Upload
            </button>
          </form>
          {uploadStatus && <div className="text-sm text-green-700 mt-2">{uploadStatus}</div>}
          {uploadError && (
            <pre className="text-sm text-red-700 mt-2 whitespace-pre-wrap bg-red-50 p-3 rounded">
              {typeof uploadError === 'string' ? uploadError : JSON.stringify(uploadError, null, 2)}
            </pre>
          )}
        </Section>

        <Section title={`Roster (${roster?.rows?.length ?? 0} rows)`}>
          {roster?.rows?.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-gray-500 border-b">
                  <tr>
                    <th className="py-2 pr-4">Staff ID</th>
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Store</th>
                    <th className="py-2 pr-4">Role</th>
                    <th className="py-2 pr-4">Joined</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Variants</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.rows.map((r) => (
                    <tr key={r.staff_id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono">{r.staff_id}</td>
                      <td className="py-2 pr-4">{r.full_name}</td>
                      <td className="py-2 pr-4">{r.store_name}</td>
                      <td className="py-2 pr-4">{r.role}</td>
                      <td className="py-2 pr-4">{r.joined_date}</td>
                      <td className="py-2 pr-4">{r.status}</td>
                      <td className="py-2 pr-4 text-xs text-gray-500">
                        {r.real_call_agent_name_variants.join(' · ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-gray-500 text-sm">No roster uploaded yet.</div>
          )}
        </Section>

        <Section title="Coverage">
          {coverage?.stores?.length ? (
            <ul className="space-y-1 text-sm">
              {coverage.stores.map((s) => (
                <li key={s.store_name}>
                  <span className="font-semibold">{s.store_name}</span>: {s.with_variants}/{s.total} (
                  {s.coverage_pct}%)
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-gray-500 text-sm">No coverage data.</div>
          )}
        </Section>

        <Section title={`Audit log (last ${auditRows.length})`}>
          {auditRows.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs font-mono">
                <thead className="text-left text-gray-500 border-b">
                  <tr>
                    <th className="py-2 pr-4">ts</th>
                    <th className="py-2 pr-4">actor</th>
                    <th className="py-2 pr-4">action</th>
                    <th className="py-2 pr-4">target</th>
                  </tr>
                </thead>
                <tbody>
                  {auditRows.map((row, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1.5 pr-4">{row.ts}</td>
                      <td className="py-1.5 pr-4">{row.actor_staff_id || row.actor_email || '—'}</td>
                      <td className="py-1.5 pr-4">{row.action}</td>
                      <td className="py-1.5 pr-4">{row.target}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-gray-500 text-sm">No audit rows yet.</div>
          )}
        </Section>
      </div>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="max-w-[1200px] mx-auto px-8 py-10">
        <h1 className="text-2xl font-bold text-gray-900 heading-font mb-6">Trainer Admin</h1>
        {children}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
      <h2 className="text-lg font-bold text-gray-900 mb-4">{title}</h2>
      {children}
    </section>
  );
}
