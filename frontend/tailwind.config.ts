import type { Config } from 'tailwindcss';

/**
 * Палитра — та же «Сталь + Золото», что у портала, но без механики тематизации клубов: здесь
 * некому переопределять тему, поэтому значения лежат прямо здесь, а не в CSS-переменных.
 * Формат «R G B» сохранён — он нужен альфа-модификаторам Tailwind (bg-primary/15).
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'rgb(24 20 16 / <alpha-value>)',
        'background-secondary': 'rgb(28 24 17 / <alpha-value>)',
        card: 'rgb(38 33 25 / <alpha-value>)',
        foreground: 'rgb(237 231 220 / <alpha-value>)',
        'text-secondary': 'rgb(200 192 180 / <alpha-value>)',
        'text-muted': 'rgb(150 142 130 / <alpha-value>)',
        'text-faint': 'rgb(112 105 95 / <alpha-value>)',
        border: 'rgb(62 54 42 / <alpha-value>)',
        'border-light': 'rgb(78 68 52 / <alpha-value>)',
        primary: 'rgb(201 168 76 / <alpha-value>)',
        'primary-light': 'rgb(223 195 116 / <alpha-value>)',
        'primary-foreground': 'rgb(24 20 16 / <alpha-value>)',
        weekend: 'rgb(176 106 74 / <alpha-value>)',
        danger: 'rgb(198 92 76 / <alpha-value>)',
      },
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};

export default config;
