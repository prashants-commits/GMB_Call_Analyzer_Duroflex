import React from 'react';

/**
 * Reusable card for sections in the Detail Page.
 * Provides consistent styling, border, and optional header/badge.
 */
export default function SectionCard({ 
  title, 
  subtitle, 
  badge, 
  children, 
  className = "", 
  variant = "white", // white, gray, red, blue
  headerAction 
}) {
  const variantStyles = {
    white: "bg-white border-gray-200",
    gray: "bg-gray-50 border-gray-200",
    blue: "bg-blue-50 border-blue-200",
    red: "bg-red-50 border-red-200",
  };

  return (
    <div className={`border-2 rounded-2xl p-6 shadow-sm overflow-hidden ${variantStyles[variant]} ${className}`}>
      {(title || subtitle || badge || headerAction) && (
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            {subtitle && (
              <span className="font-mono text-xs text-gray-500 tracking-widest uppercase block mb-1">
                {subtitle}
              </span>
            )}
            {title && (
              <h2 className="text-2xl font-bold text-gray-900 heading-font">
                {title}
              </h2>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            {badge && <div>{badge}</div>}
            {headerAction && <div>{headerAction}</div>}
          </div>
        </div>
      )}
      <div className="relative">
        {children}
      </div>
    </div>
  );
}
