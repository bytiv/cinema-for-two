import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        cinema: {
          bg: '#0f0a1a',
          surface: '#1a1226',
          card: '#231b33',
          border: '#2e2445',
          'border-light': '#3d3256',
          accent: '#e8a0bf',
          'accent-light': '#f0c4d8',
          'accent-dark': '#c47a9e',
          secondary: '#a78bfa',
          'secondary-light': '#c4b5fd',
          warm: '#fbbf7e',
          'warm-light': '#fcd9a8',
          text: '#f0e6f6',
          'text-muted': '#9b8bb0',
          'text-dim': '#6b5a80',
          success: '#6ee7b7',
          error: '#fca5a5',
        },
      },
      fontFamily: {
        display: ['"Playfair Display"', 'serif'],
        body: ['"DM Sans"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      animation: {
        'float-slow': 'float 20s ease-in-out infinite',
        'float-medium': 'float 15s ease-in-out infinite',
        'float-fast': 'float 10s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'pulse-glow': 'pulseGlow 3s ease-in-out infinite',
        'fade-in': 'fadeIn 0.5s ease-out forwards',
        'slide-up': 'slideUp 0.5s ease-out forwards',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px) rotate(0deg)' },
          '25%': { transform: 'translateY(-20px) rotate(2deg)' },
          '50%': { transform: 'translateY(-10px) rotate(-1deg)' },
          '75%': { transform: 'translateY(-25px) rotate(1deg)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(232, 160, 191, 0.3)' },
          '50%': { boxShadow: '0 0 40px rgba(232, 160, 191, 0.6)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'cinema-gradient': 'linear-gradient(135deg, #0f0a1a 0%, #1a1226 50%, #231b33 100%)',
      },
    },
  },
  plugins: [],
};

export default config;
