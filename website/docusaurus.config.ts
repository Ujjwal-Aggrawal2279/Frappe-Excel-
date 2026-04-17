import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Excel View',
  tagline: 'The spreadsheet experience for every Frappe DocType',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://ujjwal-aggrawal2279.github.io',
  baseUrl: '/Frappe-Excel-/',

  organizationName: 'Ujjwal-Aggrawal2279',
  projectName: 'Frappe-Excel-',

  onBrokenLinks: 'warn',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/Ujjwal-Aggrawal2279/Frappe-Excel-/tree/main/website/',
          showLastUpdateTime: true,
          showLastUpdateAuthor: true,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/excel-view-social.png',
    colorMode: {
      defaultMode: 'light',
      respectPrefersColorScheme: true,
    },
    announcementBar: {
      id: 'v35',
      content: '🚀 Excel View v3.5 is live — Clean Data Panel, PROMPT() formula, and more. <a href="/docs/changelog">See what\'s new</a>',
      backgroundColor: '#1a73e8',
      textColor: '#ffffff',
      isCloseable: true,
    },
    navbar: {
      title: 'Excel View',
      logo: {
        alt: 'Excel View Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'User Guide',
        },
        {
          to: '/docs/changelog',
          label: 'Changelog',
          position: 'left',
        },
        {
          href: 'https://github.com/Ujjwal-Aggrawal2279/Frappe-Excel-',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'User Guide',
          items: [
            { label: 'Getting Started', to: '/docs/getting-started/intro' },
            { label: 'Grid Basics', to: '/docs/grid/overview' },
            { label: 'Keyboard Shortcuts', to: '/docs/reference/keyboard-shortcuts' },
          ],
        },
        {
          title: 'Features',
          items: [
            { label: 'Smart Lookup', to: '/docs/data/smart-lookup' },
            { label: 'Charts & Pivot', to: '/docs/analysis/charts' },
            { label: 'Formulas', to: '/docs/formulas/overview' },
          ],
        },
        {
          title: 'More',
          items: [
            { label: 'GitHub', href: 'https://github.com/Ujjwal-Aggrawal2279/Frappe-Excel-' },
            { label: 'Report an Issue', href: 'https://github.com/Ujjwal-Aggrawal2279/Frappe-Excel-/issues' },
            { label: 'Changelog', to: '/docs/changelog' },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Excel View. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['python', 'bash', 'json'],
    },
    algolia: undefined,
  } satisfies Preset.ThemeConfig,
};

export default config;
