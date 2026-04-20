// Static manifest of Tier 1 Resources shipped with the app.
//
// Markdown source files live in `frontend/src/resources/markdown/` and are
// bundled inline via Vite's `?raw` suffix so they render without a network
// request. The same markdown is also served from `frontend/public/resources/`
// for direct download, alongside the Word (.docx) version. That duplication
// is intentional — the bundled copy powers the in-app preview, the public
// copies power the download links.
//
// Manifest ids use hyphens with an `item-` prefix (e.g., `item-1-2`). This
// string is the lookup key Phase C will use to map Tier 1 assessment item
// refs to the resource that addresses them. Do not change these ids without
// updating the Phase C lookup table at the same time.

import mtssTeamRolesMd from './markdown/1.2-mtss-team-roles.md?raw';
import mtssHandbookMd from './markdown/1.3-mtss-handbook.md?raw';
import annualCalendarMd from './markdown/1.4-annual-mtss-calendar.md?raw';
import highLeverageMd from './markdown/2.3-high-leverage-tier1-practices.md?raw';
import disciplineFlowMd from './markdown/3.4-sample-discipline-flowchart.md?raw';
import parentResultsMd from './markdown/7.3-parent-assessment-results-summary.md?raw';

export const RESOURCES = [
  {
    id: 'item-1-2',
    itemRef: '1.2',
    title: 'MTSS Team Roles Template',
    description:
      "Template for defining and rotating roles on your building's MTSS Design & Implementation Team — Facilitator, Data Lead, Note-Taker, Time-Keeper, and standing members. Revisit annually.",
    roles: ['admin', 'staff'],
    files: {
      docx: '/resources/1.2-mtss-team-roles.docx',
    },
    markdownContent: mtssTeamRolesMd,
  },
  {
    id: 'item-1-3',
    itemRef: '1.3',
    title: 'MTSS Handbook',
    description:
      "Seven-section template for your building's Tier 1 implementation plan: vision, team, expectations, discipline, screening, data review, and PD. The shared reference document your team returns to all year.",
    roles: ['admin', 'staff'],
    files: {
      docx: '/resources/1.3-mtss-handbook.docx',
    },
    markdownContent: mtssHandbookMd,
  },
  {
    id: 'item-1-4',
    itemRef: '1.4',
    title: 'Annual MTSS Calendar',
    description:
      'Yearly calendar template for screening windows, team meetings, data reviews, and PD sessions — organized by category so conflicts surface in August, not October.',
    roles: ['admin', 'staff'],
    files: {
      docx: '/resources/1.4-annual-mtss-calendar.docx',
    },
    markdownContent: annualCalendarMd,
  },
  {
    id: 'item-2-3',
    itemRef: '2.3',
    title: 'High-Leverage Tier 1 Practices',
    description:
      'Working synthesis of six instructional and behavioral practices with the strongest evidence base for universal-tier implementation. Use it for PD planning and walkthrough design.',
    roles: ['admin', 'staff'],
    files: {
      docx: '/resources/2.3-high-leverage-tier1-practices.docx',
    },
    markdownContent: highLeverageMd,
  },
  {
    id: 'item-3-4',
    itemRef: '3.4',
    title: 'Sample Discipline Flowchart',
    description:
      'Concrete worked example of a Tier 1 discipline flowchart showing how staff should respond to off-track behavior. Customize the categories and escalation steps before adopting.',
    roles: ['admin', 'staff'],
    files: {
      docx: '/resources/3.4-sample-discipline-flowchart.docx',
    },
    markdownContent: disciplineFlowMd,
  },
  {
    id: 'item-7-3',
    itemRef: '7.3',
    title: 'Parent Assessment Results Summary',
    description:
      'Staff-facing template for communicating universal screening results to parents — translates scores into plain-language context and next steps. Fill in one instance per student per screening window.',
    roles: ['admin', 'staff'],
    files: {
      docx: '/resources/7.3-parent-assessment-results-summary.docx',
    },
    markdownContent: parentResultsMd,
  },
];
