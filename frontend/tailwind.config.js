/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        dark: {
          900: '#0b0f17',
          800: '#111827',
          700: '#1f2937',
          600: '#374151',
        },
        brand: {
          primary: '#6366f1',
          success: '#10b981',
          warning: '#f59e0b',
          danger: '#ef4444',
          accent: '#8b5cf6',
        }
      }
    },
  },
  plugins: [],
}
