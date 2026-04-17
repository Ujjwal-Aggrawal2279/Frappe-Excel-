import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/getting-started/intro">
            Get Started →
          </Link>
          <Link
            className="button button--outline button--lg"
            style={{marginLeft: '12px', color: '#fff', borderColor: 'rgba(255,255,255,0.6)'}}
            to="/docs/reference/keyboard-shortcuts">
            Keyboard Shortcuts
          </Link>
        </div>
      </div>
    </header>
  );
}

function FeatureCard({icon, title, description}: {icon: string; title: string; description: string}) {
  return (
    <div className="col col--4" style={{marginBottom: '2rem'}}>
      <div style={{
        padding: '1.5rem',
        borderRadius: '8px',
        border: '1px solid var(--ifm-toc-border-color)',
        height: '100%',
      }}>
        <div style={{fontSize: '2rem', marginBottom: '0.5rem'}}>{icon}</div>
        <h3 style={{marginBottom: '0.5rem'}}>{title}</h3>
        <p style={{margin: 0, fontSize: '0.92em', color: 'var(--ifm-font-color-secondary)'}}>{description}</p>
      </div>
    </div>
  );
}

const features = [
  {
    icon: '⚡',
    title: 'Inline Editing',
    description: 'Edit any Frappe DocType field directly in the grid. Changes stage locally and save in bulk with Ctrl+S.',
  },
  {
    icon: '🧮',
    title: '500+ Formulas',
    description: 'Full HyperFormula engine with Excel-compatible functions plus 7 ERP-native Frappe formulas (GL_BALANCE, STOCK_QTY, ITEM_PRICE, …).',
  },
  {
    icon: '🔗',
    title: 'Smart Lookup',
    description: 'Auto-detect foreign key relationships and join columns from related DocTypes — no SQL, no code.',
  },
  {
    icon: '📊',
    title: 'Charts & Pivot',
    description: 'Built-in chart builder and interactive pivot tables from any sheet. No external tool needed.',
  },
  {
    icon: '📋',
    title: 'Child Tables',
    description: 'Expand any row to view and edit its child table records inline. Full CRUD — add rows, delete rows, edit rich text.',
  },
  {
    icon: '📄',
    title: 'Rich Text Fields',
    description: 'Text Editor and HTML fields render live previews in the grid. Double-click to open the full ProseMirror editor modal.',
  },
  {
    icon: '💾',
    title: 'Workbooks',
    description: 'Save multi-sheet configurations with full formatting, Smart Lookup, and pivot state. Share workbooks with teammates.',
  },
  {
    icon: '📤',
    title: 'Import & Export',
    description: 'Bulk import CSV/XLSX (including tree structures). Export to XLSX with company name and filter headers.',
  },
  {
    icon: '🌙',
    title: 'Dark Theme',
    description: 'Full dark theme support. Every component — grid, modals, sidebar, charts — respects the Frappe theme toggle.',
  },
];

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={siteConfig.title}
      description="Excel View — the spreadsheet experience for every Frappe DocType. Inline editing, formulas, Smart Lookup, charts, pivot tables, child tables, and more.">
      <HomepageHeader />
      <main>
        <section style={{padding: '3rem 0'}}>
          <div className="container">
            <div style={{textAlign: 'center', marginBottom: '2.5rem'}}>
              <h2>Everything you need for bulk data work in Frappe</h2>
              <p style={{color: 'var(--ifm-font-color-secondary)', maxWidth: '600px', margin: '0 auto'}}>
                Excel View adds a full spreadsheet layer to every DocType — without modifying Frappe core.
              </p>
            </div>
            <div className="row">
              {features.map((f) => (
                <FeatureCard key={f.title} {...f} />
              ))}
            </div>
          </div>
        </section>

        <section style={{
          background: 'var(--ifm-color-emphasis-100)',
          padding: '3rem 0',
          borderTop: '1px solid var(--ifm-toc-border-color)',
        }}>
          <div className="container" style={{textAlign: 'center'}}>
            <h2>Ready to get started?</h2>
            <p style={{color: 'var(--ifm-font-color-secondary)'}}>
              Install Excel View in minutes and open any DocType in spreadsheet mode.
            </p>
            <Link className="button button--primary button--lg" to="/docs/getting-started/installation">
              Installation Guide →
            </Link>
          </div>
        </section>
      </main>
    </Layout>
  );
}
