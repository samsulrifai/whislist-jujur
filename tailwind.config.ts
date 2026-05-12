import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#FFF8E8',
        'paper-warm': '#F8EED8',
        'paper-deep': '#EEDDBD',
        ink: '#211E19',
        'ink-muted': '#6E6252',
        line: '#D8C6A3',
        saved: '#1F8A4C',
        warning: '#F07A24',
        danger: '#D9432F',
        ai: '#2454D6',
        sticker: '#FFD84D',
      },
      fontFamily: {
        display: ['Fraunces', 'serif'],
        body: ['Atkinson Hyperlegible', 'sans-serif'],
        mono: ['Martian Mono', 'monospace'],
      },
      boxShadow: {
        ink: '4px 4px 0 #211E19',
        'ink-lg': '6px 6px 0 #211E19',
      },
    },
  },
  plugins: [],
} satisfies Config;
