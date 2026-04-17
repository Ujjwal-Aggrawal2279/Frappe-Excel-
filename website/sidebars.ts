import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: [
        'getting-started/intro',
        'getting-started/installation',
        'getting-started/first-view',
        'getting-started/navigation',
      ],
    },
    {
      type: 'category',
      label: 'The Grid',
      items: [
        'grid/overview',
        'grid/selecting-cells',
        'grid/editing-cells',
        'grid/row-operations',
        'grid/column-operations',
        'grid/find-replace',
        'grid/freeze-columns',
        'grid/tree-view',
      ],
    },
    {
      type: 'category',
      label: 'Sheets & Workbooks',
      items: [
        'sheets/sheet-types',
        'sheets/managing-sheets',
        'sheets/workbooks',
      ],
    },
    {
      type: 'category',
      label: 'Column Management',
      items: [
        'columns/choosing-columns',
        'columns/reordering',
        'columns/resizing',
        'columns/hiding',
        'columns/meta-column',
        'columns/activity-column',
      ],
    },
    {
      type: 'category',
      label: 'Data Entry',
      items: [
        'data-entry/inline-editing',
        'data-entry/bulk-save',
        'data-entry/validation',
        'data-entry/flash-fill',
        'data-entry/child-tables',
        'data-entry/rich-text-fields',
        'data-entry/undo-redo',
      ],
    },
    {
      type: 'category',
      label: 'Formatting',
      items: [
        'formatting/number-formats',
        'formatting/cell-colors',
        'formatting/bold-italic-align',
        'formatting/borders',
        'formatting/conditional-formatting',
        'formatting/focus-cell',
        'formatting/repeat-last-action',
      ],
    },
    {
      type: 'category',
      label: 'Formulas',
      items: [
        'formulas/overview',
        'formulas/excel-formulas',
        'formulas/frappe-formulas',
        'formulas/precedent-highlighting',
        'formulas/formula-bar',
      ],
    },
    {
      type: 'category',
      label: 'Data & Analysis',
      items: [
        'data/smart-lookup',
        'data/report-sheets',
        'data/filtering',
        'data/sorting',
      ],
    },
    {
      type: 'category',
      label: 'Charts & Pivot',
      items: [
        'analysis/charts',
        'analysis/pivot-tables',
        'analysis/query-flow',
      ],
    },
    {
      type: 'category',
      label: 'Import & Export',
      items: [
        'import-export/export-xlsx',
        'import-export/export-csv',
        'import-export/import-data',
        'import-export/tree-import',
      ],
    },
    {
      type: 'category',
      label: 'Collaboration',
      items: [
        'collaboration/sidebar',
        'collaboration/comments',
        'collaboration/sharing',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        'reference/keyboard-shortcuts',
        'reference/toolbar-buttons',
        'reference/frappe-formulas-reference',
        'reference/permissions',
        'reference/troubleshooting',
        'reference/faq',
      ],
    },
    'changelog',
  ],
};

export default sidebars;
