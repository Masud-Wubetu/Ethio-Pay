/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#070a12',
        surface: '#121929',
        border: 'rgba(255, 255, 255, 0.08)',
        primary: '#38bdf8',
        emerald: '#10b981',
        rose: '#f43f5e',
        amber: '#f59e0b',
      },
    },
  },
  plugins: [],
};

