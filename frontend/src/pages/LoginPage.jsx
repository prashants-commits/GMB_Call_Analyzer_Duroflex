import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const STATIC_USERS = [
  { email: 'micky@duroflexworld.com', password: 'duroflex123' },
  { email: 'jopu@duroflexworld.com', password: 'duroflex123' },
  { email: 'anup@duroflexworld.com', password: 'duroflex123' },
  { email: 'mitesh@duroflexworld.com', password: 'duroflex123' },
  { email: 'mukul@duroflexworld.com', password: 'duroflex123' },
  { email: 'admin@duroflexworld.com', password: 'duroflex123' }
];

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = (e) => {
    e.preventDefault();
    const user = STATIC_USERS.find(u => u.email === email && u.password === password);
    
    if (user) {
      localStorage.setItem('isAuthenticated', 'true');
      localStorage.setItem('userEmail', email);
      navigate('/');
    } else {
      setError('Invalid email or password. Please try again.');
    }
  };

  return (
    <div className="h-screen w-screen flex bg-white text-gray-900 font-inter" style={{ minWidth: '1024px', overflow: 'hidden' }}>
      {/* Left side: Branding & Features */}
      <div className="w-1/2 h-full bg-duro-red flex flex-col justify-between p-16 relative overflow-hidden text-white">
        <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '32px 32px' }}></div>
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-white rounded-full mix-blend-overlay filter blur-3xl opacity-20"></div>

        <div className="relative z-10 flex items-center space-x-3">
          <div className="w-12 h-12 bg-white rounded flex items-center justify-center text-duro-red font-black text-2xl tracking-tighter">D</div>
          <h1 className="text-3xl font-bold tracking-tight">Duroflex</h1>
        </div>

        <div className="relative z-10 mt-12">
          <h2 className="text-5xl font-extrabold mb-4 leading-tight tracking-tight">Duro Conversations<br />Analyzer</h2>
          <p className="text-xl font-medium tracking-widest uppercase text-red-100 mb-12">AI Powered Intelligence</p>

          <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-8 shadow-2xl">
            <h3 className="text-lg font-semibold mb-6 border-b border-white/20 pb-2">Executive Overview Capabilities</h3>
            <div className="grid grid-cols-2 gap-y-8 gap-x-6">
              {[
                "Learn from Real Customer Interactions",
                "Identify Hot leads & Not so worthy Leads",
                "Ensure Top notch Customer Experience",
                "Personalized Training for Brand Representatives",
                "Know more about your Customers",
                "Discover what are the Purchase Barriers"
              ].map((feature, idx) => (
                <div key={idx} className="flex items-start space-x-4">
                  <div className="bg-white/20 p-2 rounded-lg flex-shrink-0">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium leading-relaxed">{feature}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="relative z-10 text-sm text-red-200">
          &copy; 2026 Duroflex Internal Systems. Executive Access Only.
        </div>
      </div>

      {/* Right side: Login Form */}
      <div className="w-1/2 h-full flex flex-col justify-center px-24 bg-duro-gray relative">
        <div className="max-w-md w-full mx-auto">
          <div className="mb-12">
            <h3 className="text-4xl font-bold text-gray-900 mb-3">Welcome back.</h3>
            <p className="text-lg text-gray-600">Please enter your credentials to access the intelligence dashboard.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            {error && (
              <div className="p-3 text-sm text-red-600 bg-red-100 border border-red-200 rounded-lg">
                {error}
              </div>
            )}
            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-gray-800 mb-1">Corporate Email</label>
              <input 
                id="email" 
                type="email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="leadership@duroflex.com" 
                required 
                className="appearance-none block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-duro-red focus:border-transparent text-gray-900 transition duration-150 text-base"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="password" class="block text-sm font-semibold text-gray-800">Password</label>
              </div>
              <input 
                id="password" 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••" 
                required 
                className="appearance-none block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-duro-red focus:border-transparent text-gray-900 transition duration-150 text-base"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center">
                <input id="remember-me" name="remember-me" type="checkbox" className="h-4 w-4 text-duro-red focus:ring-duro-red border-gray-300 rounded cursor-pointer" />
                <label htmlFor="remember-me" className="ml-2 block text-sm text-gray-700 cursor-pointer">
                  Keep me logged in
                </label>
              </div>
              <a href="#" className="text-sm font-semibold text-duro-red hover:text-duro-darkred transition">Forgot password?</a>
            </div>

            <div className="pt-4">
              <button type="submit" className="w-full flex justify-center py-3.5 px-4 border border-transparent rounded-lg shadow text-base font-bold text-white bg-duro-red hover:bg-duro-darkred focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-duro-red transition duration-150">
                Access Dashboard
              </button>
            </div>
          </form>

          <div className="mt-12 pt-8 border-t border-gray-200">
            <p className="text-xs text-gray-500 text-center leading-relaxed">
              This is a secure system restricted to authorized Duroflex Leadership and Sales Executives. All activities on this system are logged and monitored.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
