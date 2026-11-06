import type { Config } from 'tailwindcss';

/**
 * Оформление перенесено из портала hema.ru один в один: календарь — его часть, и выглядеть
 * должен так же. Цвета ссылаются на переменные из globals.css (формат «R G B» — ради
 * альфа-модификаторов вида bg-primary/15), шкала размеров и шрифтовая пара — портальные.
 *
 * Чего отсюда намеренно нет: медалей и наград (результатов календарь не хранит), пергамента и
 * тем (переключателя тем здесь нет), витринных токенов клубов.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: 'rgb(var(--c-bg) / <alpha-value>)',
          secondary: 'rgb(var(--c-bg-secondary) / <alpha-value>)',
        },
        card: 'rgb(var(--c-card) / <alpha-value>)',
        border: {
          DEFAULT: 'rgb(var(--c-border) / <alpha-value>)',
          light: 'rgb(var(--c-border-light) / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'rgb(var(--c-accent) / <alpha-value>)',
          light: 'rgb(var(--c-accent-light) / <alpha-value>)',
          foreground: 'rgb(var(--c-accent-fg) / <alpha-value>)',
        },
        // Сетка календаря: цвета смысловые, а не палитровые — полоса турнира, выходные,
        // «остывшее» прошедшее.
        calendar: {
          bar: 'rgb(var(--cal-bar) / <alpha-value>)',
          barHover: 'rgb(var(--cal-bar-hover) / <alpha-value>)',
          weekend: 'rgb(var(--cal-weekend) / <alpha-value>)',
          past: 'rgb(var(--cal-past) / <alpha-value>)',
          pastText: 'rgb(var(--cal-past-text) / <alpha-value>)',
          pastTextMuted: 'rgb(var(--cal-past-text-muted) / <alpha-value>)',
          pastUnsuitable: 'rgb(var(--cal-past-unsuitable) / <alpha-value>)',
          pastUnsuitableText: 'rgb(var(--cal-past-unsuitable-text) / <alpha-value>)',
        },
        foreground: 'rgb(var(--c-text) / <alpha-value>)',
        text: {
          secondary: 'rgb(var(--c-text-secondary) / <alpha-value>)',
          muted: 'rgb(var(--c-text-muted) / <alpha-value>)',
          faint: 'rgb(var(--c-text-faint) / <alpha-value>)',
        },
        danger: '#c0392b',
      },
      fontFamily: {
        heading: ['var(--font-playfair)', 'serif'],
        sans: ['var(--font-inter)', 'sans-serif'],
        display: ['var(--font-playfair)', 'serif'],
      },
      // Шкала портала: каждый размер примерно на 2pt крупнее умолчаний Tailwind. Без неё текст
      // календаря заметно мельче портального — первое, что бросается в глаза рядом.
      fontSize: {
        xs: ['0.9167rem', { lineHeight: '1.1667rem' }],
        sm: ['1.0417rem', { lineHeight: '1.4167rem' }],
        base: ['1.1667rem', { lineHeight: '1.6667rem' }],
        lg: ['1.2917rem', { lineHeight: '1.9167rem' }],
        xl: ['1.4167rem', { lineHeight: '1.9167rem' }],
        '2xl': ['1.6667rem', { lineHeight: '2.1667rem' }],
        '3xl': ['2.0417rem', { lineHeight: '2.4167rem' }],
        '4xl': ['2.4167rem', { lineHeight: '2.6667rem' }],
        '5xl': ['3.1667rem', { lineHeight: '1' }],
      },
    },
  },
  plugins: [],
};

export default config;
