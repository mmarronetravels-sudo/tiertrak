/**
 * Tier 1 Self-Assessment — Item Bank (v1.0)
 *
 * Source of truth for the 26 items, 8 domains, scoring anchors, and
 * recommendation text displayed in the Tier 1 Self-Assessment feature.
 *
 * IMMUTABILITY RULE
 * -----------------
 * Item `id` values are STABLE IDENTIFIERS. Once an item ships under a given
 * ID, that ID must not be reused for a different item. Historical responses
 * in `tier1_assessment_responses.item_id` depend on this to render correctly
 * years later.
 *
 * If an item needs to be retired, leave its ID alone and mark it retired via
 * a future field. If an item needs to be added, give it a NEW id (e.g.,
 * '9.1' for a new domain, or '1.5' for a new item in Domain 1).
 *
 * Item TEXT (title, question, anchors, recommendation) MAY be revised. When
 * that happens, bump ITEM_BANK_VERSION so historical assessments can render
 * with a version marker.
 *
 * See docs/features/tier1-assessment/ for the full design.
 */

const ITEM_BANK_VERSION = 'v1.0';

const DOMAINS = [
  { number: 1, title: 'Team & Infrastructure', maxItems: 4 },
  { number: 2, title: 'Universal Academic Instruction', maxItems: 4 },
  { number: 3, title: 'Universal Behavior Supports', maxItems: 4 },
  { number: 4, title: 'Universal SEL Supports', maxItems: 4 },
  { number: 5, title: 'Universal Screening & Interim Assessment', maxItems: 4 },
  { number: 6, title: 'Data-Based Decision Making', maxItems: 4 },
  { number: 7, title: 'Family Engagement', maxItems: 3 },
  { number: 8, title: 'Professional Development & Coaching', maxItems: 3 }
];

const ITEMS = [
  // ============================================================
  // Domain 1 — Team & Infrastructure
  // ============================================================
  {
    id: '1.1',
    domain: 1,
    title: 'MTSS Design & Implementation Team exists and meets regularly',
    question: 'Is there a designated building-level MTSS Design & Implementation Team (sometimes called a Tier 1 Team or Universal Supports Team) that meets at least monthly during the school year? This is distinct from a Student Support Team that handles individual tiering decisions.',
    anchors: {
      0: 'No designated system-level MTSS team exists, or the team exists on paper but does not meet.',
      1: 'A team exists and meets, but less than monthly, on an inconsistent schedule, or its focus is routinely pulled into individual student cases rather than universal practices.',
      2: 'A designated MTSS Design & Implementation Team meets at least monthly on a published schedule, with a clear focus on Tier 1 systems; meetings happen even when no standing topic feels urgent.'
    },
    recommendation: 'Establish a standing monthly meeting on the school calendar with a published start and end time. The team should include administration, a grade-level or department representative from each level served, and at least one specialist (counselor, school psychologist, or interventionist). Protect the agenda for system-level work — if individual student conversations dominate, they belong on the Student Support Team\'s agenda instead. Consistency of cadence matters more than length.'
  },
  {
    id: '1.2',
    domain: 1,
    title: 'Team roles are defined',
    question: 'Does the MTSS team have defined roles (e.g., facilitator, data lead, note-taker, time-keeper) that are documented and consistently filled?',
    anchors: {
      0: 'No defined roles; meetings run ad hoc or the principal runs everything.',
      1: 'Some roles are informally understood but not documented, or roles rotate without a rotation plan.',
      2: 'Roles are documented in a team charter or handbook and are filled at every meeting (by role, not by person — a substitute can step in).'
    },
    recommendation: 'Draft a one-page team roles document listing facilitator, data lead, note-taker, and time-keeper responsibilities. Assign primary and backup people for each role so meetings can still function when someone is absent. Review role assignments at the start of each school year. (See the ScholarPath Resources section for an MTSS Team Roles template.)'
  },
  {
    id: '1.3',
    domain: 1,
    title: 'Written Tier 1 plan or handbook',
    question: 'Is there a written Tier 1 plan or MTSS handbook that describes universal practices and is accessible to all staff?',
    anchors: {
      0: 'No written plan; Tier 1 practices live in individual teachers\' heads.',
      1: 'A plan exists but is outdated (>2 years old), incomplete, or not easily accessible to staff.',
      2: 'A current written plan is available to all staff (shared drive, handbook, wiki), reviewed annually, and referenced in staff meetings.'
    },
    recommendation: 'Start small — a 5–10 page document covering school-wide expectations, the discipline flowchart, screening schedule, and data-meeting cadence is more valuable than an exhaustive binder no one reads. Store it where staff already look for other reference documents. Set a yearly review date on the team\'s calendar. (See the ScholarPath Resources section for an MTSS Handbook template.)'
  },
  {
    id: '1.4',
    domain: 1,
    title: 'Annual MTSS calendar',
    question: 'Does the team publish an annual calendar showing screening windows, data review dates, and Tier 1 PD events?',
    anchors: {
      0: 'No calendar; events are scheduled reactively.',
      1: 'Some events are on the calendar but not all, or the calendar is not shared with staff.',
      2: 'A complete annual calendar is published before the school year starts, includes screening windows and data review dates, and is visible to all staff.'
    },
    recommendation: 'At the end of each school year, block out the next year\'s calendar: fall/winter/spring screening windows, monthly team meetings, data review days after each screening window, and at least one Tier 1–focused PD session. Share with staff during summer onboarding or the first week of school. (See the ScholarPath Resources section for an Annual MTSS Calendar template.)'
  },

  // ============================================================
  // Domain 2 — Universal Academic Instruction
  // ============================================================
  {
    id: '2.1',
    domain: 2,
    title: 'Core curriculum aligned to standards',
    question: 'Is there a documented core curriculum in ELA and math aligned to state standards, consistently used across classrooms at each grade level?',
    anchors: {
      0: 'No adopted core curriculum, or teachers select their own materials without alignment.',
      1: 'A curriculum is adopted but implementation varies significantly across classrooms, or it is only partially aligned to standards.',
      2: 'A standards-aligned core curriculum is adopted, implemented across all classrooms at each grade level, and pacing is coordinated.'
    },
    recommendation: 'Confirm the adopted curriculum is current (within the typical 6–8 year adoption cycle) and aligned to state standards. Establish grade-level pacing guides so students moving between classrooms encounter consistent content. If the curriculum is inconsistent across classrooms, schedule walkthroughs to identify the gaps rather than assuming fidelity.'
  },
  {
    id: '2.2',
    domain: 2,
    title: 'Protected core instructional time',
    question: 'Is there a defined block of core instructional time in ELA and math that is protected from interruption (announcements, pull-outs, assemblies)?',
    anchors: {
      0: 'Core instruction is frequently interrupted or reduced; no protected block is defined.',
      1: 'A protected block exists in theory but is interrupted with some regularity.',
      2: 'A protected core block is defined for ELA and math, schedule-wide, and interruptions are rare exceptions that require administrative approval.'
    },
    recommendation: 'Define minimum daily minutes for core ELA and math at each grade level and put them on the master schedule. Work with front office staff to minimize announcements during those windows. Move pull-out services (speech, ELL, Tier 2/3 interventions) to times that don\'t conflict with core instruction whenever possible.'
  },
  {
    id: '2.3',
    domain: 2,
    title: 'Differentiation within Tier 1',
    question: 'Do teachers routinely differentiate core instruction (grouping, scaffolds, tiered tasks) to meet the range of student needs within the classroom?',
    anchors: {
      0: 'Instruction is delivered whole-group only; no routine differentiation.',
      1: 'Some teachers differentiate consistently; others rarely do. No school-wide approach.',
      2: 'Differentiation within Tier 1 is an expected practice, supported by PD and coaching, and visible in walkthroughs across classrooms.'
    },
    recommendation: 'Identify 1–2 high-leverage differentiation practices (small-group instruction during core, tiered questioning, scaffolded graphic organizers) and make them the focus of PD for a semester. Pair PD with coaching cycles — one-shot workshops rarely change classroom practice. Use walkthroughs to check for implementation, not to evaluate teachers. (See the ScholarPath Resources section for a High-Leverage Tier 1 Practices reference guide.)'
  },
  {
    id: '2.4',
    domain: 2,
    title: 'Documented fidelity of core instruction',
    question: 'Is core instructional fidelity monitored through walkthroughs, lesson plan review, or similar routine?',
    anchors: {
      0: 'No routine monitoring of core instruction beyond formal evaluation.',
      1: 'Monitoring happens inconsistently or is limited to formal teacher evaluation cycles.',
      2: 'A non-evaluative walkthrough or lesson review process runs on a defined cadence (e.g., monthly) with aggregated results discussed by the team.'
    },
    recommendation: 'Design a short (5–10 minute) walkthrough look-fors tool focused on 3–4 Tier 1 practices. Keep it non-evaluative — the goal is system-level data, not individual teacher ratings. Rotate walkthroughs across grade levels and subjects so the team sees the whole picture.'
  },

  // ============================================================
  // Domain 3 — Universal Behavior Supports
  // ============================================================
  {
    id: '3.1',
    domain: 3,
    title: 'School-wide expectations are defined',
    question: 'Are 3–5 positively-stated, school-wide behavior expectations defined and agreed upon by staff?',
    anchors: {
      0: 'No school-wide expectations exist, or each classroom sets its own.',
      1: 'School-wide expectations exist but are not consistently known or used by staff.',
      2: '3–5 positively-stated expectations (e.g., Be Safe, Be Respectful, Be Responsible) are defined, staff can name them, and they are used consistently.'
    },
    recommendation: 'Convene a representative staff group to draft 3–5 expectations, stated positively (what to do, not what not to do). Get input from students and families before finalizing. Keep the list short — schools that define 8–10 expectations usually find staff can\'t remember them all.'
  },
  {
    id: '3.2',
    domain: 3,
    title: 'Expectations are explicitly taught and posted',
    question: 'Are the school-wide expectations explicitly taught to students and visibly posted in classrooms and common areas?',
    anchors: {
      0: 'Expectations are not taught or posted.',
      1: 'Expectations are posted in some areas but not taught, or taught only at the start of the year and not revisited.',
      2: 'Expectations are explicitly taught in the first weeks of school, re-taught after breaks and in response to data, and posted in all classrooms and common areas with location-specific examples (hallway, cafeteria, etc.).'
    },
    recommendation: 'Develop a behavior expectations matrix showing what each expectation looks like in each school setting (classroom, hallway, cafeteria, playground, bus). Build short (10–15 minute) lessons for the first two weeks of school and schedule "booster" lessons after winter and spring breaks. Print the matrix for every classroom and common area.'
  },
  {
    id: '3.3',
    domain: 3,
    title: 'School-wide acknowledgment system',
    question: 'Is there a school-wide system for acknowledging students who demonstrate the expectations?',
    anchors: {
      0: 'No consistent acknowledgment system; individual teachers use their own approaches or none.',
      1: 'An acknowledgment system exists but is used inconsistently (some staff, some settings).',
      2: 'A school-wide acknowledgment system (tickets, shout-outs, recognition routines) is used by all staff in all settings, tied explicitly to the school-wide expectations.'
    },
    recommendation: `A working acknowledgment system has three ingredients that matter more than what token you hand out:

• Specificity. The acknowledgment names the expectation being reinforced — "Thanks for being respectful, you held the door for the kindergartners" — rather than generic praise like "good job." Specific acknowledgment teaches the expectation each time it's used; generic praise doesn't.

• Equity of distribution. Pull a week's worth of acknowledgments and check whether they reach the full range of students, or cluster on a small group. The students who most need adult validation are often the ones least likely to earn tokens under a purely compliance-based system. Redesign to catch effort and improvement, not just compliance.

• Universal staff use. Every adult — including cafeteria staff, bus drivers, paraprofessionals, and office staff — uses the system in every setting. An acknowledgment system that only "lives" in classrooms leaves the settings where conflict often starts unsupported.

Most acknowledgment systems fail on the second point. The specific mechanism matters much less than getting these three ingredients right.`
  },
  {
    id: '3.4',
    domain: 3,
    title: 'Discipline flowchart with defined classroom-managed vs. office-managed behaviors',
    question: 'Is there a documented discipline flowchart that distinguishes classroom-managed from office-managed behaviors, with defined response steps for each?',
    anchors: {
      0: 'No flowchart; responses to behavior vary by staff member and situation.',
      1: 'A flowchart exists but is not consistently used, or the classroom-managed vs. office-managed distinction is unclear in practice.',
      2: 'A documented flowchart defines which behaviors are classroom-managed and which require office referral, with defined response steps at each level; staff apply it consistently.'
    },
    recommendation: `Draft a one-page flowchart with both categories and response steps defined. The structure might look like this:

Classroom-managed behaviors (minor disruption, off-task, mild disrespect, dress-code issue):
1. Non-verbal redirect
2. Private re-teach of the expectation
3. Brief conference with the student plus family contact
4. If a pattern emerges across days, request Student Support Team consultation

Office-managed behaviors (fighting, weapons, drugs, harassment targeting a protected class, sustained defiance after classroom steps, significant property damage):
Office referral → administrator investigation → consequences per the student code of conduct → family contact → consideration for tier change if a pattern emerges.

Train all staff, including paraprofessionals and supervisors of common areas, on the flowchart. Review office discipline referral data quarterly to check whether it's being applied consistently — if ODRs spike after the flowchart is introduced, it often means staff are finally referring behaviors that had previously been tolerated inconsistently, which is progress, not a problem. (See the ScholarPath Resources section for a sample Discipline Flowchart.)`
  },

  // ============================================================
  // Domain 4 — Universal SEL Supports
  // ============================================================
  {
    id: '4.1',
    domain: 4,
    title: 'SEL curriculum or structured approach',
    question: 'Is there an adopted SEL curriculum or structured approach (advisory, morning meeting, explicit lessons) delivered to all students?',
    anchors: {
      0: 'No structured SEL approach; any SEL is informal or teacher-dependent.',
      1: 'A curriculum or approach is adopted but delivered inconsistently across classrooms or grade levels.',
      2: 'A curriculum or structured approach is adopted, delivered to all students on a defined cadence (e.g., weekly), and aligned to a competency framework (CASEL or similar).'
    },
    recommendation: 'Identify which CASEL competencies your school will prioritize (self-awareness, self-management, social awareness, relationship skills, responsible decision-making). Select a curriculum or structure (morning meeting, advisory, standalone lessons) that delivers those competencies weekly. Ensure every classroom is delivering it, not just interested teachers.'
  },
  {
    id: '4.2',
    domain: 4,
    title: 'SEL competencies integrated into daily routines',
    question: 'Are SEL competencies reinforced in daily routines beyond the dedicated SEL block (e.g., restorative practices, check-ins, explicit skill coaching)?',
    anchors: {
      0: 'SEL only exists during the dedicated SEL block, if at all.',
      1: 'Some teachers integrate SEL into daily routines; others do not.',
      2: 'SEL integration is an expected daily practice (e.g., morning check-in, closing circle, restorative conversations after conflict), visible across classrooms.'
    },
    recommendation: 'Pick 1–2 daily routines that reinforce SEL — a 2-minute morning check-in, a closing circle, restorative conversations after conflict — and make them expected practice school-wide. These don\'t require curriculum; they require consistency.'
  },
  {
    id: '4.3',
    domain: 4,
    title: 'Staff-student relationship-building practices',
    question: 'Are there structures that ensure every student has at least one caring, consistent adult relationship at school?',
    anchors: {
      0: 'No intentional structure; relationships form by chance.',
      1: 'Some structures exist (advisory, mentorship) but don\'t reach all students.',
      2: 'A structure (advisory, check-in/check-out, looping, mentorship) is in place that ensures every student has a consistent adult connection, and the team reviews whether any student is "unknown" to all staff.'
    },
    recommendation: 'Run a simple exercise at a staff meeting: post every student\'s name and ask staff to initial the ones they know well. Students without initials, or with only one, are the focus. Build structures (advisory, lunch bunches, mentorship) that close those gaps. The goal isn\'t elaborate programming — it\'s ensuring no student is invisible.'
  },
  {
    id: '4.4',
    domain: 4,
    title: 'Trauma-informed / culturally responsive practices',
    question: 'Do staff receive training and use practices that are trauma-informed and culturally responsive?',
    anchors: {
      0: 'No training or intentional practice in these areas.',
      1: 'Some training has happened but it hasn\'t translated into consistent classroom practice.',
      2: 'Staff have had recurring training (not a one-off) and team members can name specific trauma-informed or culturally responsive practices in use, supported by coaching.'
    },
    recommendation: 'One-off PD rarely changes practice in these areas. Look for training providers or internal coaches who offer recurring engagement over a semester or year. Focus first on what staff can do differently — greeting students at the door, offering regulation options, examining the cultural relevance of classroom materials — rather than on frameworks alone.'
  },

  // ============================================================
  // Domain 5 — Universal Screening & Interim Assessment
  // ============================================================
  {
    id: '5.1',
    domain: 5,
    title: 'Academic interim assessment is conducted for all students',
    question: 'Do all students participate in interim assessments in reading (and math, where applicable to grade levels served) at least twice per year?',
    anchors: {
      0: 'No universal academic interim assessment, or assessment is done only for students already flagged.',
      1: 'Academic interim assessment is conducted but not for all students, or only once per year.',
      2: 'All students participate in interim assessments in reading (and math where appropriate) at least twice per year; coverage is verified.'
    },
    recommendation: 'Select a validated interim assessment appropriate for your grade levels — for example DIBELS, STAR, aimsweb, mCLASS, or NWEA MAP Growth. Schedule fall and spring windows at minimum; add a winter window if feasible. Verify coverage — new students, students absent during the window, and students pulled for other services often get missed. (Intervention Monitoring\'s Universal Screener Upload can help surface coverage gaps.)'
  },
  {
    id: '5.2',
    domain: 5,
    title: 'Behavior / SEL screening is conducted for all students',
    question: 'Are all students screened in behavior or SEL at least once per year?',
    anchors: {
      0: 'No behavior/SEL screening conducted.',
      1: 'Behavior/SEL screening happens for some students (e.g., teacher nomination only) but is not universal.',
      2: 'All students are screened in behavior or SEL at least once per year using a validated instrument (e.g., BESS, SAEBRS, DESSA).'
    },
    recommendation: 'Behavior/SEL screening is the most commonly skipped universal screening. Teacher-rated screeners (SAEBRS, BESS Teacher Form) can be completed in 1–3 minutes per student and catch internalizing concerns (anxiety, withdrawal) that office discipline referrals miss entirely. Start with a single fall administration and expand from there.'
  },
  {
    id: '5.3',
    domain: 5,
    title: 'Cut scores and decision rules are documented',
    question: 'Are cut scores and decision rules for flagging students "at risk" documented and consistently applied?',
    anchors: {
      0: 'No documented cut scores; flagging decisions are made case-by-case.',
      1: 'Cut scores exist (from the assessment publisher) but the team\'s decision rules for action are inconsistent.',
      2: 'Cut scores and team decision rules (e.g., "below the 25th percentile triggers a Tier 2 conversation") are documented and applied consistently.'
    },
    recommendation: 'Write down your decision rules. "Below the 25th percentile on the reading assessment triggers a Tier 2 consideration" is a decision rule. "We\'ll look at it" is not. Document the rules where the team can see them at every data meeting. Revisit rules annually — not every session, or they become meaningless.'
  },
  {
    id: '5.4',
    domain: 5,
    title: 'Assessment results are reviewed by the team promptly',
    question: 'Does the team review assessment results within 2–3 weeks of each administration, and are decisions documented?',
    anchors: {
      0: 'Results are not systematically reviewed by the team.',
      1: 'Results are reviewed eventually, but the delay is often long enough that the data is stale before action is taken.',
      2: 'Data review meetings are scheduled within 2–3 weeks of each assessment window; decisions about individual students and system-level patterns are documented.'
    },
    recommendation: 'Put data review dates on the annual calendar at the same time you schedule the assessment windows. Review at both levels: individual students (who needs follow-up) and system-level patterns (is Tier 1 working for the bulk of students?). If 50%+ of students are below benchmark, the problem is Tier 1, not student-level intervention needs.'
  },

  // ============================================================
  // Domain 6 — Data-Based Decision Making
  // ============================================================
  {
    id: '6.1',
    domain: 6,
    title: 'Team reviews multiple data sources at every meeting',
    question: 'Does the team routinely review multiple data sources (attendance, office discipline referrals, grades, assessment results) at each meeting?',
    anchors: {
      0: 'Data is rarely or never reviewed in meetings; discussions are narrative-only.',
      1: 'Some data is reviewed but inconsistently, or the team relies on a single data source (e.g., only ODRs).',
      2: 'Multiple data sources are reviewed at every meeting using a standard agenda or protocol.'
    },
    recommendation: 'Build a standing data agenda into every team meeting — even if it\'s a single 10-minute slot. Rotate the focus so each data source gets deep attention on some schedule (e.g., attendance in October, ODRs in November, assessment data in December). Standardize how data is presented (same format, same charts) so the team spends time thinking, not interpreting slides.'
  },
  {
    id: '6.2',
    domain: 6,
    title: 'Protocol for tiering decisions (Tier 1 → Tier 2)',
    question: 'Is there a documented protocol the team follows to decide when a student moves from Tier 1 to Tier 2?',
    anchors: {
      0: 'Tiering decisions are made informally, or based on teacher request alone.',
      1: 'A general approach exists but isn\'t documented; decisions are inconsistent across students or grade levels.',
      2: 'A documented protocol defines the data required, the review steps, and the decision criteria for moving a student to Tier 2.'
    },
    recommendation: 'Write down the protocol. It might be as simple as: "A student is considered for Tier 2 when assessment data is below the 25th percentile AND one of: grades below C, >10% attendance gaps, >3 ODRs. The team reviews these students at the monthly data meeting using [protocol name]." Documentation makes decisions reviewable; reviewability makes them better over time. (Intervention Monitoring\'s 11-step Pre-Referral Form is designed to support a documented Tier 1 → Tier 2 protocol.)'
  },
  {
    id: '6.3',
    domain: 6,
    title: 'Tier 1 effectiveness is evaluated at the system level',
    question: 'Does the team evaluate Tier 1 effectiveness at the system level (e.g., are ~80% of students meeting benchmark?), separate from individual student decisions?',
    anchors: {
      0: 'Tier 1 is not evaluated at the system level; all data conversations are about individual students.',
      1: 'Some system-level evaluation happens (e.g., at end-of-year) but not regularly.',
      2: 'The team evaluates Tier 1 effectiveness at least twice per year and acts on findings (e.g., adjusts PD focus, curriculum, schedule).'
    },
    recommendation: 'Add a system-level data review to the fall and spring calendar. Ask: are at least 80% of our students meeting benchmark with Tier 1 alone? If not, the issue is Tier 1, not a shortage of Tier 2/3 services. This conversation is uncomfortable but essential — it\'s the difference between a school that keeps expanding intervention and one that actually gets better.'
  },
  {
    id: '6.4',
    domain: 6,
    title: 'Tier 1 decisions are documented and tracked over time',
    question: 'Are team decisions about Tier 1 (curriculum adjustments, PD priorities, schedule changes) documented and revisited?',
    anchors: {
      0: 'Decisions are made in meetings but not tracked; there\'s no institutional memory.',
      1: 'Some decisions are documented in meeting notes but rarely revisited.',
      2: 'Decisions are tracked in a running document with owners and due dates, and revisited at subsequent meetings.'
    },
    recommendation: 'Add a "decisions & owners" section to every meeting note. Each decision gets a person, a by-when date, and a status. Revisit the list at the next meeting before starting new business. This alone will surface more patterns in Tier 1 implementation than any other single practice.'
  },

  // ============================================================
  // Domain 7 — Family Engagement
  // ============================================================
  {
    id: '7.1',
    domain: 7,
    title: 'Families are informed about the MTSS framework',
    question: 'Are families informed about how MTSS works at the school and their role in it?',
    anchors: {
      0: 'Families are not informed about MTSS as a framework.',
      1: 'Some communication exists (one-time letter, handbook mention) but families don\'t know what MTSS means at the school.',
      2: 'Families receive clear, accessible communication about MTSS at enrollment and recurring points; communication is in relevant languages.'
    },
    recommendation: 'Prepare a one-page plain-language explainer of MTSS at your school — what it means if their child is in Tier 1, Tier 2, or Tier 3, and how decisions are made. Share at enrollment, at the start of the year, and when a tiering decision is made. Translate into the languages your families speak.'
  },
  {
    id: '7.2',
    domain: 7,
    title: 'Two-way family communication channels',
    question: 'Does the school have channels for families to provide input and feedback, not just receive it?',
    anchors: {
      0: 'Communication flows one direction — school to family.',
      1: 'Some feedback mechanisms exist but are rarely used or reviewed.',
      2: 'Multiple two-way channels exist (surveys, family council, office hours, home visits) and feedback is reviewed and acted on by leadership.'
    },
    recommendation: 'Pick one two-way channel to strengthen this year rather than launching many at once. A brief end-of-year family survey with 5 questions, actually reviewed by the team, is more valuable than an elaborate family council that meets twice and disbands.'
  },
  {
    id: '7.3',
    domain: 7,
    title: 'Families understand universal screening and interim assessment results for their student',
    question: 'When universal screening or interim assessments are administered, do families receive clear, accessible information about their student\'s results and what those results mean?',
    anchors: {
      0: 'Families don\'t receive universal assessment results, or results are shared only when a student is flagged for intervention.',
      1: 'Results are shared with families but in a format that\'s hard to interpret (raw scores, percentiles without explanation), or only for flagged students.',
      2: 'All families receive their student\'s results after each administration in a plain-language format that explains what the results mean, how they compare to benchmark, and what the school is doing in response (at Tier 1 or higher as appropriate).'
    },
    recommendation: 'Design a one-page parent-facing summary template that goes home after each assessment window. Include: what the assessment measures, the student\'s score, what "at benchmark" looks like for that grade, and what the school does for all students at Tier 1. If the student\'s score triggers a Tier 2 conversation, say so clearly. Translate into the languages your families speak. Sharing universal results with every family — not just flagged students — is the single biggest lever for family understanding of MTSS, and it signals that Tier 1 data matters for every kid, not just the ones in intervention. (See the ScholarPath Resources section for a Parent Assessment Results Summary template. Intervention Monitoring\'s Parent Portal also supports ongoing family visibility into linked students, interventions, and progress logs.)'
  },

  // ============================================================
  // Domain 8 — Professional Development & Coaching
  // ============================================================
  {
    id: '8.1',
    domain: 8,
    title: 'Tier 1 professional development at least annually',
    question: 'Do all staff receive professional development on Tier 1 practices at least annually, aligned to the school\'s Tier 1 plan?',
    anchors: {
      0: 'No dedicated Tier 1 PD; any PD is on other topics.',
      1: 'PD happens but is one-off, disconnected from the Tier 1 plan, or reaches only some staff.',
      2: 'All staff (including paraprofessionals and support staff) receive at least annual PD on Tier 1 practices, coordinated with the MTSS plan.'
    },
    recommendation: 'Dedicate at least one PD day per year to Tier 1 practices specifically — not generic differentiation or generic SEL, but the actual practices your school has committed to. Include paraprofessionals and support staff. PD that doesn\'t connect to a documented Tier 1 plan tends to fade; PD that explicitly reinforces the plan sticks.'
  },
  {
    id: '8.2',
    domain: 8,
    title: 'Coaching or implementation support is available',
    question: 'Is coaching, peer observation, or other implementation support available to staff working on Tier 1 practices?',
    anchors: {
      0: 'No implementation support beyond initial PD.',
      1: 'Support exists but is limited (e.g., only for new teachers or only on request).',
      2: 'A coaching structure is in place (instructional coach, peer observation, PLC with observation cycles) that supports all staff in Tier 1 implementation.'
    },
    recommendation: 'Joyce & Showers (2002) found that professional development alone — workshops and readings without follow-up — produces relatively weak classroom implementation, while PD paired with coaching and in-classroom follow-through produces substantially higher implementation rates. The specific figures in that research have been debated, but the underlying finding is well-established: coaching multiplies the effect of training. If you can\'t hire a coach, build peer observation cycles into existing PLC time — teachers observe each other on an agreed look-for, then debrief. Low-cost, high-impact, and it builds internal capacity.'
  },
  {
    id: '8.3',
    domain: 8,
    title: 'New staff onboarding into the MTSS framework',
    question: 'Are new staff (including mid-year hires and long-term substitutes) onboarded into the school\'s MTSS framework and Tier 1 practices?',
    anchors: {
      0: 'No formal onboarding into MTSS; new staff learn by watching.',
      1: 'Some orientation exists but is inconsistent, or happens only for fall-hire teachers.',
      2: 'A documented onboarding process exists for all new staff (including mid-year hires and long-term subs) covering the Tier 1 plan, discipline flowchart, screening schedule, and SEL approach.'
    },
    recommendation: 'Build a 60–90 minute MTSS onboarding session into your new-hire orientation. Include: the Tier 1 plan, the discipline flowchart, the school-wide expectations, the screening schedule, and who to ask for help. Assign each new hire a mentor for the first semester. Mid-year hires often miss MTSS entirely if onboarding only happens in August.'
  }
];

// Derived helpers -------------------------------------------------

// Max possible raw score: 26 items × 2 points = 52.
const MAX_SCORE = ITEMS.length * 2;

// Map of item_id -> item, for O(1) lookup by route handlers.
const ITEMS_BY_ID = Object.freeze(
  ITEMS.reduce((acc, item) => {
    acc[item.id] = item;
    return acc;
  }, {})
);

// Score band thresholds (percentage of MAX_SCORE).
// Implementing: 80–100%, Partial: 50–79%, Installing: 0–49%.
const SCORE_BANDS = [
  { band: 'implementing', min: 80, max: 100, label: 'Implementing with Fidelity' },
  { band: 'partial',      min: 50, max: 79,  label: 'Partial Implementation' },
  { band: 'installing',   min: 0,  max: 49,  label: 'Installing / Exploration' }
];

function bandForPercentage(pct) {
  if (pct == null || Number.isNaN(pct)) return null;
  if (pct >= 80) return 'implementing';
  if (pct >= 50) return 'partial';
  return 'installing';
}

module.exports = {
  ITEM_BANK_VERSION,
  DOMAINS,
  ITEMS,
  ITEMS_BY_ID,
  MAX_SCORE,
  SCORE_BANDS,
  bandForPercentage
};
