import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import Header from '../../components/Header';
import { trainer, TrainerHTTPError } from '../../utils/trainerApi';

export default function TrainerHome() {
  const navigate = useNavigate();
  const [actor, setActor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    trainer
      .me()
      .then((data) => setActor(data.actor))
      .catch((err) => {
        if (err instanceof TrainerHTTPError && err.status === 401) {
          navigate('/trainer/identify', { replace: true });
        } else {
          setError(err.message);
        }
      })
      .finally(() => setLoading(false));
  }, [navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="max-w-[1200px] mx-auto px-8 py-12 text-gray-500">Loading…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="max-w-[1200px] mx-auto px-8 py-12">
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-700">{error}</div>
        </div>
      </div>
    );
  }

  if (!actor) return null;

  const isAdmin = actor.role === 'admin';
  const isManagerOrAbove = ['manager', 'cluster_head', 'admin'].includes(actor.role);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="max-w-[1200px] mx-auto px-8 py-10">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 mb-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 heading-font">AI Trainer</h1>
              <p className="text-gray-500 mt-2">
                Welcome, <span className="font-semibold text-gray-900">{actor.full_name}</span> — {actor.store_name}
                <span className="ml-2 inline-block px-2 py-0.5 text-xs font-semibold rounded-full bg-blue-50 text-blue-700">
                  {actor.role}
                </span>
              </p>
            </div>
            <button
              onClick={async () => {
                await trainer.logout();
                navigate('/trainer/identify', { replace: true });
              }}
              className="text-sm text-gray-500 hover:text-red-600"
            >
              Switch user
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Link to="/trainer/drill/new">
            <Card title="🎯 Practice mock calls" body="Drill against AI-customer personas — 5-minute audio role-play." />
          </Link>
          <Link to="/trainer/drills">
            <Card title="📒 Drill history" body="Browse score cards from completed mock calls across all agents." />
          </Link>
          <Link to={`/trainer/swot/${encodeURIComponent(actor.store_name)}`}>
            <Card title="📊 Store SWOT" body={`Strengths & weaknesses for ${actor.store_name}, synthesised from your latest calls.`} />
          </Link>
          {isManagerOrAbove && (
            <Card title="📈 Adoption" body="Track your team's training cadence. (Coming in Group F.)" disabled />
          )}
          {isAdmin && (
            <Link to="/trainer/admin">
              <Card title="🔧 Admin" body="Manage roster, personas, and audit log." />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function Card({ title, body, disabled }) {
  return (
    <div
      className={`bg-white rounded-2xl border border-gray-200 p-6 transition ${
        disabled
          ? 'opacity-60 cursor-not-allowed'
          : 'hover:border-blue-300 hover:shadow-md cursor-pointer'
      }`}
    >
      <h3 className="text-lg font-bold text-gray-900">{title}</h3>
      <p className="text-sm text-gray-500 mt-2">{body}</p>
    </div>
  );
}
