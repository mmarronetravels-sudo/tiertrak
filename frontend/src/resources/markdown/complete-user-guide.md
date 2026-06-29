# ScholarPath Intervention Management — Complete User Guide

*Every feature, every role — from sign-in to year-end roll-up. For administrators, counselors, interventionists, teachers, education assistants, and parents.*

## 1. About this guide

This guide covers everything ScholarPath Intervention Management can do, organized feature by feature. ScholarPath is a Multi-Tiered System of Supports (MTSS / RTI) platform: it helps your school track students who need extra academic, behavioral, or social-emotional support, document the interventions you try, monitor whether those interventions are working, and make data-informed decisions about moving students between tiers of support.

It is written for everyone who uses the platform. Because what you can see and do depends on your role, most sections include a short note on who can perform each action. If a button or screen described here isn't visible to you, it is almost always because your role doesn't include that capability — not because something is broken.

Throughout this guide, the **exact words** you'll see on screen — button labels, menu names, status values — are shown in bold so you can match them to what's in front of you.

> **A note on roles.** ScholarPath has eight roles: **district admin**, **district tech admin**, **school admin**, **counselor**, **interventionist**, **teacher**, **education assistant**, and **parent/guardian**. A ninth, **operator**, is the platform support team. Section 2 introduces them; the appendix has a full permission matrix.

## 2. Getting started: signing in and finding your way around

### Signing in

Open ScholarPath in your web browser and you'll land on the **ScholarPath Intervention Management** sign-in screen. There are two ways to sign in:

- **Staff** sign in with their school email and password, or with Google single sign-on. Either works for staff accounts.
- **Parents and guardians** sign in with email and password only. Parent accounts cannot use Google sign-on.

If you forget your password, choose **Forgot your password?**, enter your email, and select **Send Reset Link**. To go back, use **← Back to Sign In**.

> **If sign-in fails.** For your security, the error message is deliberately general ("Invalid email or password") and won't tell you which part was wrong. Double-check your email and password. If you're a parent trying to use Google, switch to email and password instead.

### Finding your way around

After signing in, staff see a navigation bar across the top. The buttons you see depend on your role; common ones include **Dashboard**, **Students**, **Resources**, **Discipline**, **Discipline Reports**, **My District / District Report**, **Grade Roll-up**, and **Admin**. At the top-right you'll always see your name and role, a **Change password** option, and **Sign out**. Parents don't see this staff navigation — they go straight to their own portal (Section 14).

### The eight roles at a glance

- **District admin** — District-wide access to everything, including roll-up, admin, and discipline.
- **District tech admin** — District-wide configuration and integrations; elevated read access.
- **School admin** — Full access within their building, including roll-up and discipline.
- **Counselor** — Sees all students in the school, manages interventions, reviews discipline.
- **Interventionist** — Sees all students, manages interventions, uploads documents.
- **Teacher** — Sees assigned students plus all Tier 1 students; manages interventions and logs progress.
- **Education assistant** — Logs progress for assigned students; files discipline referrals; view-only otherwise.
- **Parent / guardian** — A separate portal showing only their own linked child or children.

A ninth role, **operator**, is the platform support team.

## 3. The Dashboard

The Dashboard is your home base — titled **MTSS Dashboard**, subtitle **Multi-Tiered System of Supports Overview**. It pulls together what needs your attention into alert cards. The cards you see depend on your role; administrators, counselors, and interventionists see the full set, while teachers and education assistants see a lighter view focused on their own students.

Cards include **Tier 1 Self-Assessment**, **Weekly Reminder: Log Progress** (with frequency chips like **Daily**, **3x/wk**, **2x/wk**, **Bi-wkly**, **Weekly**), **Documents Expiring Soon**, **MTSS Referral Candidates** (with **👁 Monitor** and **Review →**), and **Monitoring**. There's also a **New Discipline Referral** button for quickly logging an incident.

## 4. Students and the student record

The **Students** area is where you add students, open their records, and manage their status. Counselors, interventionists, school admins, and district admins can add and edit students; only a district admin can permanently delete one.

**Adding a student:** choose **Add Student**. **First name**, **last name**, and **grade** are required. Set the **Tier** (**Tier 1/2/3**) and, optionally, an area of concern (**Academic**, **Behavior**, **Social-Emotional**), a secondary area, a risk level, and a unique SIS/external ID.

**Demographic fields** under **Student Demographics** are all optional, including **IEP**, **Section 504 Plan**, and **English Learner (EL/ELL)** flags.

> **Blank is not the same as "no."** The IEP, 504, and English Learner flags have three states: yes, no, and unknown. Leaving one blank records as **unknown**, not "no." Set them deliberately when you know the answer.

**Archiving:** choose **Archive Student** (this preserves all intervention history) with a required **Reason for archiving** — **Completed Interventions**, **End of School Year**, **Transferred Out**, **No Longer Needs Support**, or **Other**. To bring a student back, choose **Reactivate Student**.

You can also bulk-import students from a CSV; an import summary banner reports how many rows imported and names any that failed.

## 5. Screeners (MAP and STAR)

ScholarPath imports universal screener results and displays them on each student's record. It supports **STAR** (Renaissance) and **MAP (NWEA)**.

**Uploading:** open **Upload Screener Data**, choose the **Screener**, **School Year**, **Period** (**Fall/Winter/Spring**), and **Subject** (**Reading/Math/Early Literacy**). Export your file (STAR from Renaissance; MAP from MAP Growth → Class Profile → Download .CSV, up to 5 MB), choose **Choose CSV File**, then **Validate** — a dry run that saves nothing. Review the counts (**Total rows**, **Will be saved (matched)**, **Already on file (will update)**, **Unmatched**, **Ambiguous name**, **Validation errors**) and confirm if there are no errors.

> **Matching & MAP.** Students are matched by first and last name; unmatched rows are skipped, not added — check the **Unmatched** count. The STAR import is well established; the MAP import works end-to-end but its column mapping is still being validated against real NWEA exports, so sanity-check the validate-step counts for a MAP file before confirming.

**Resetting a batch:** **Reset Screener Data** permanently deletes a batch so it can be re-uploaded; you must type **DELETE** to confirm. Only **school admins** and **district admins** can reset.

## 6. Intervention plans and the Intervention Menu

An intervention is the specific support strategy for a student. The **Intervention Menu** (Intervention Bank) is your school's catalog; an **intervention plan** documents one student's intervention. District admins, district tech admins, school admins, counselors, interventionists, and teachers can manage interventions; education assistants and parents cannot.

**The Intervention Plan** shows a status badge — **Draft** or **Complete** — and autosaves ("Saving..." then "Auto-saved"). Use **Edit Plan**, **Mark Complete**, and **Close**; sign by typing your full name.

**Setting a goal:** choose **Set Intervention Goal** and enter a **Goal Description**, **Target Date**, and **Target Rating**, then **Save Goal**. Ratings run **No Progress → Minimal → Some → Good → Significant Progress**.

> **"Note only" interventions.** Documentation-only interventions show a **Note only** badge and are exempt from the overdue-log reminders in the next section.

## 7. Progress monitoring and overdue-log reminders

Progress monitoring is the heart of MTSS. Anyone who manages interventions can log progress; education assistants can log for students on their caseload (but can't edit or delete logs). Parents log their own observations through the portal.

**Logging:** open **Log Weekly Progress** and enter the **Date**, the **Implementation Status** (**Implemented as Planned**, **Partially Implemented**, **Not Implemented**, **Student Absent**), the **Progress Rating (1-5)**, the student's response (**Engaged**, **Cooperative**, **Resistant**, **Frustrated**, **Distracted**), and any **Notes**, then **Save Progress Log**. View trends in the **Progress Over Time** chart.

**When is a log overdue?** When the intervention is active, the student isn't archived, the intervention requires monitoring (not **Note only**), and no progress has been logged within the expected window (weeks start Monday). For most plans that means the current week; for plans on a biweekly cadence, a log in either the current or the prior week keeps it current.

> **About overdue logic.** The overdue check now respects two things it used to ignore: your school's academic calendar and each plan's logging frequency. Reminders pause during the term breaks your school has entered (see The academic calendar, below), so an intervention left **active** over a break won't keep flagging until classes resume, and a biweekly plan isn't counted overdue in an off week. This applies to both the reminder email and the **Weekly Reminder: Log Progress** card on the dashboard. Closing out finished interventions still keeps your reminders meaningful.

**The weekly reminder email** (subject **Weekly Reminder: Log Progress**) goes to staff with overdue logs at their school. **School admins** control whether their building receives it, from the **Weekly overdue-logs reminder** card in Admin settings; the default is **on**. District admins can set it for a district or single school, and support can do it by request.

**The academic calendar.** School admins set their building's term and break dates from the **Academic calendar** card in Admin settings, and the overdue-log reminders use those dates to pause during breaks. Choose **Add**, set the **Type** (**Term (in session)** or **Break (out of session)**), enter a **Start date** and **End date**, add an optional **Label** (such as "Winter Break"), then **Add entry**. Edit a row with the pencil icon and **Save changes**, or remove it with the trash icon. Keeping the calendar current keeps reminders aligned with your school year.

## 8. MTSS meetings and the referral process

**Referring a student into MTSS:** start a **Pre-Referral Form** from a Tier 1 student's record. The form has eleven steps — Referral Information, Area of Concern, Detailed Description, Medical & Background, Current Academic Performance, Existing Plans & Supports, Prior Interventions Attempted (pre-filled), Student Strengths, Parent/Guardian Contact, Reason for Referral, and Recommendations (including a **Recommended Tier**: **Tier 2 – Targeted Support** or **Tier 3 – Intensive Support**). Use **Save & Close** and **Previous/Next**; when ready, **Submit for Approval** (sign by typing your name). Counselors, school admins, and district admins review submitted referrals.

> **Where reviewing happens today.** A submitted referral routes to counselors and admins, but the approve / request-changes step currently happens behind the scenes rather than through an on-screen button. The submission itself still goes through; if your team expects an in-app "approve" screen, raise it with your administrator. Approving a referral records the decision — it doesn't auto-create a plan or meeting; your team creates those manually.

**Progress-review meetings:** open **New MTSS Progress Review Meeting**. Record the meeting type (**4-Week Review**, **6-Week Review**, **Final Review**, **Other**), which meeting it is (**1st/2nd/3rd Meeting (Final)**), and the tier decision (e.g., **Stay at Tier 2 – Continue current interventions**, **Move to Tier 3 – Needs more intensive support**, **Refer for Special Education evaluation**, **Refer for 504 Plan evaluation**), then **Save Meeting**.

> **Meetings capture a snapshot.** Saving a meeting stores a fixed snapshot of the progress data reviewed; editing later doesn't rewrite it, preserving an accurate record of what was discussed.

Schools can designate an **MTSS Coordinator** from the staff list for broader student access.

## 9. Tier 1 tools and Resources

**The Tier 1 self-assessment** rates how well your school has universal supports in place — not an assessment of any student. It covers 26 items across eight domains (**Team & Infrastructure**, **Universal Academic Instruction**, **Universal Behavior Supports**, **Universal SEL Supports**, **Universal Screening & Interim Assessment**, **Data-Based Decision Making**, **Family Engagement**, **Professional Development & Coaching**), each rated **Not in place / Partially in place / Fully in place**. Results place your school in **Installing / Exploration**, **Partial Implementation**, or **Implementing with Fidelity**.

**Resources** is a shared library of downloadable MTSS templates and guides. Every staff member sees the same library; each item shows a title, description, in-page preview, and **Download Word** button. School-wide user guides like this one live here too.

## 10. Discipline referrals

Any staff member (not parents) can file a referral; reviewing and resolving them is limited to administrators.

**Filing:** a three-step wizard — choose the **Student** and **Behavior**; record **Where it happened**, **When** (not in the future), any required subtype, and either **What happened** or **Response notes**; then **Continue** → **Submit referral**.

**Reviewing (administrators):** the **Discipline review queue** lists referrals by status — **Submitted**, **Under review**, **Resolved**. School admins, district admins, counselors, and interventionists can view; only school and district admins can act (counselors/interventionists are read-only). To work one: **Claim for review**, document **Admin notes**, then **Resolve…** with one or more **Consequences**. **Release back to queue** hands it off.

## 11. Discipline Reports and demographics

**Discipline Reports** turns referral data into trends. Filter by **Start date**, **End date**, and **Status**; **Refresh** and **Export CSV**. Reports include **Aggregate cuts** (**By location**, **By incident type**, **By time of day**) and **Per-person cuts** (**Students with [n]+ referrals**, **By staff**). The **By staff** view is limited to school and district admins.

> **Treat exports as sensitive student data.** The CSV export includes student names, IDs, grade, IEP/504/English-Learner flags, gender, and race/ethnicity, plus staff names. Download, store, and share only as your privacy policies allow (Section 16).

## 12. Grade Roll-up (end of year)

The **End-of-Year Grade Roll-up** promotes students and records who graduated or left. Only district admins and school admins can run it.

1. Choose the **School**, then the **Terminal grade** (students at this grade graduate; everyone else advances).
2. Optionally **Designate students leaving** who are exiting but not graduating.
3. Choose **Preview roll-up** — nothing changes yet.
4. If correct, **Commit roll-up**.
5. If you spot a problem, **Undo this run** (available immediately after a commit).

> **Two safeguards.** You can't commit while any student has an unclassified grade ("Fix each one in their profile, then re-preview"). And if grades change between preview and commit, the stale commit is rejected and you re-preview.

## 13. Section 504 plans and accommodations

Where a 504 form set is enabled, a **Section 504** tab appears on the student record. Each student's history is organized into cycles, each holding **Form C — Prior Notice and Consent to Evaluate**, **Form I — Section 504 Eligibility Determination**, and **Form J — Section 504 Student Accommodation Plan**.

District admins, school admins, counselors, and interventionists create and edit cycles and forms. Teachers view active accommodations only (**Educational**, **Extracurricular**, **Assessments**). Education assistants have no 504 access; parents see active plans only. Choose **Start 504 Cycle**; the newest version of each form is marked **Current**, and you add updates with **Add revision**.

> **One thing to watch.** A new Form J starts as a draft and isn't visible to parents until set to active. If a parent can't see a plan, check whether it's been activated.

## 14. The parent / guardian portal

Parents get a dedicated portal (sign in with email and password, not Google) showing only their own linked child or children. A parent can view active interventions, log their own weekly observations, see documents in limited categories (**504 Plan**, **IEP**, **Medical Record**, **Parent Communication**), and view active 504 accommodations.

Linking is done by a school or district admin. A student can have at most two parent accounts. Within a district, a parent can be linked to children at more than one school.

> **Parent links don't expire.** Once linked, a parent keeps access until an admin removes the link. When a family leaves, unlink them.

## 15. Admin and settings

The **Admin Panel** is where administrators handle setup, with tabs including **Interventions**, **Students**, **Parents**, **Staff**, **Archived**, **Import CSV**, **Plan Templates**, **Intervention Bank**, and **Screener Data**.

**Managing staff:** the **Staff** table shows each person's **Name**, **Email**, **Role**, **Access**, **Coordinator** status, **Caseload**, **SSO** connection, and **Actions**. **Add Staff → Add Staff Member** creates a Google-SSO account (no password needed). The roles you can assign depend on your own role; you can't edit your own staff record. Bulk staff import allows up to 100 rows.

**Education-assistant caseloads:** because EAs only see assigned students, an admin sets each EA's caseload via **Manage Caseload** — search by name and **Assign**.

## 16. Protecting student data

ScholarPath is built so people only see the students they're entitled to see.

- **Access follows your role and assignment.** Limits are enforced by the system, not just hidden in the interface.
- **Schools and districts are kept separate.** The platform structurally prevents reading or writing another organization's data.
- **Exports carry real student data.** Protect downloaded files: store securely, share narrowly, delete when done.
- **Emails are working prompts, not records.** The authoritative information always lives in ScholarPath. Keep reminder emails internal.

> **When in doubt, share less.** If unsure whether to forward, export, or print something with student information, treat it as confidential and check your school's data-privacy policy first.

## 17. Quick answers

**A button described here isn't showing up for me. Why?** Almost always because your role doesn't include that capability, or you're viewing a student/school you don't have access to. Check your role (top-right) and ask an administrator if needed.

**Why is an intervention still overdue when school is out?** The overdue check now pauses during the term breaks your school has entered in its academic calendar (in Admin settings), so active interventions stop flagging while school is out and resume when classes return. During session, if a student's work is genuinely finished, mark the intervention complete or archive the student so it stops flagging.

**Can I undo a grade roll-up?** Yes, but immediately — **Undo this run** is available right after you commit.

**A parent can't see their child's 504 plan. What's wrong?** A Form J starts as a draft and is invisible to parents until activated.

**Why does an imported student show "unknown" for IEP/504 when I left it blank?** Blank means "unknown," not "no." Set the flag explicitly.

**Who can turn the weekly reminder email off?** A school admin for their building, a district admin for a district or single school, or support by request. The default is on.

## 18. Appendix: role-permission matrix

"View" means see-only; "Manage" means create, edit, or act. The capabilities below are summarized per role. Parents are omitted because they only access their own child's portal.

- **District admin** — Can do everything: see and add/edit students across the district, delete students, manage interventions and plans, log and edit progress, upload and reset screener batches, file/review/resolve discipline referrals, run by-staff discipline reports, create MTSS meetings, review pre-referral forms, manage 504 cycles, run Grade Roll-up, toggle overdue reminders (district or school), manage staff, and link parents.
- **School admin** — Same broad management as a district admin within their own building, including roll-up, by-staff reports, 504 cycles, staff management, and parent linking — but cannot delete a student or toggle reminders outside their own school.
- **Counselor** — Sees all students in the school; manages interventions/plans, progress logs, screener uploads, MTSS meetings, pre-referral reviews, 504 cycles, and staff. Can view (but not resolve) discipline referrals. Cannot delete students, reset screener batches, run by-staff reports or roll-up, toggle reminders, or link parents.
- **Interventionist** — Same as a counselor for students, interventions, progress, screener uploads, MTSS meetings, and 504 cycles, and can add/manage staff. Can view discipline referrals but not resolve them, and cannot review pre-referral forms, run roll-up, or link parents.
- **Teacher** — Sees assigned students plus all Tier 1 students. Manages interventions/plans, logs and edits progress, and uploads screeners. Can file discipline referrals and act only on their own; views active 504 accommodations. Cannot add/edit/delete students, reset screeners, review pre-referrals, create MTSS meetings, run roll-up, toggle reminders, manage staff, or link parents.
- **Education assistant** — Sees only their assigned caseload. Logs progress for those students and can file discipline referrals. View-only for everything else — cannot add/edit students, edit/delete logs, manage interventions, upload screeners, review discipline, or access 504.

District tech admins have district-wide read access and manage configuration and integrations, but are view-only for the day-to-day actions above. The platform operator (support) role can act across schools and districts to handle setup and requests.
