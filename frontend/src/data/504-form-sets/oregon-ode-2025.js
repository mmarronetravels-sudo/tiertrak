// Oregon ODE Section 504 form set (v1).
//
// Source documents (see docs/references/):
//   oregon-ode-2025-section-504-handbook.pdf
//   oregon-ode-2025-form-c-prior-notice-consent.pdf
//   oregon-ode-2025-form-i-eligibility-determination.pdf
//   oregon-ode-2025-form-j-accommodation-plan.pdf
//
// formSetVersion mirrors the "Last Updated: 08/2023" footer on all three forms.
// Form letters (C / I / J) match ODE's published labeling and the persistsTo
// table mapping established in Migration 021.

// Identity exported as named constants so the staff frontend can reference
// "this tenant's form set" without scattering magic strings across components.
// Future single-tenant swap (e.g., a different state's form set) becomes a
// one-line import change in the consumer. The backend validates these against
// tenant_form_sets at cycle creation time (routes/student504.js POST /cycles),
// so a misconfigured tenant produces a clean 400 — no hard-coded coupling
// across the boundary.
export const FORM_SET_ID = 'oregon-ode-2025';
export const FORM_SET_VERSION = '08/2023';

const STUDENT_INFORMATION_FIELDS = [
  { key: 'studentName',        label: 'Student Name',        type: 'text' },
  { key: 'meetingDate',        label: 'Date',                type: 'date' },
  { key: 'dateOfBirth',        label: 'Date of Birth',       type: 'date' },
  { key: 'districtId',         label: 'District ID',         type: 'text' },
  { key: 'grade',              label: 'Grade',               type: 'text' },
  { key: 'attendingDistrict',  label: 'Attending District',  type: 'text' },
  { key: 'attendingSchool',    label: 'Attending School',    type: 'text' },
  { key: 'caseManager',        label: '504 Case Manager',    type: 'text' },
  { key: 'caseManagerContact', label: 'Case Manager Contact', type: 'text' },
];

const TEAM_TABLE_COLUMNS = [
  { key: 'name',  label: 'Name',  type: 'text' },
  { key: 'title', label: 'Title', type: 'text' },
  {
    key: 'knowledgeableOf',
    label: 'Knowledgeable of (check one)',
    type: 'radio',
    options: ['The student', 'The evaluation data', 'The placement'],
  },
];

// Verbatim from Form I page 3, in row-by-row print order
// (left-to-right, top-to-bottom across the 5-column checkbox grid).
const MAJOR_LIFE_ACTIVITIES = [
  'Seeing',
  'Thinking',
  'Walking',
  'Sleeping',
  'Communicating',
  'Hearing',
  'Concentrating',
  'Breathing',
  'Standing',
  'Interacting w/others',
  'Speaking',
  'Learning',
  'Other bodily functions',
  'Lifting',
  'Planning/Organization',
  'Reading',
  'Working',
  'Eating',
  'Bending',
  'Performing manual tasks',
  'Handwriting',
  'Caring for oneself',
  { key: 'other', label: 'Other', type: 'textInput' },
];

export const oregonOde2025 = {
  formSetId: FORM_SET_ID,
  formSetVersion: FORM_SET_VERSION,
  jurisdiction: { state: 'OR', authority: 'ODE', year: 2025 },
  sourceCitation:
    'Oregon Department of Education, Section 504 Handbook (08/2023). Forms C, I, J.',
  templateVariables: ['{{studentName}}', '{{districtName}}'],
  tenantConfig: { districtLetterheadSlot: 'tenant.letterhead' },

  forms: {
    formC: {
      formLetter: 'C',
      title: 'Prior Notice and Consent to Evaluate Under Section 504',
      // Persistence: see Migration 021.
      persistsTo: 'student_504_evaluation_consents',
      headerFields: [
        { key: 'date', label: 'Date', type: 'date' },
        {
          key: 'recipient',
          label: 'To',
          type: 'text',
          helpText: 'Parent or Student (when 18 years old)',
        },
        {
          key: 'sender',
          label: 'From',
          type: 'text',
          helpText: 'Name and Title',
        },
      ],
      bodyText:
        'This letter is to provide you notice that the district proposes to evaluate {{studentName}} and determine if they are eligible for services under Section 504 of the Rehabilitation Act of 1973.',
      proposalLeadIn:
        'The Team is proposing the following to determine if your child has a disability under Section 504:',
      evaluationMethods: {
        type: 'radio',
        options: [
          {
            key: 'assessments',
            label: 'To evaluate your child using the following assessments:',
            followUp: {
              key: 'assessmentsList',
              type: 'textarea',
              defaultRowCount: 5,
            },
          },
          {
            key: 'fileReview',
            label:
              'To evaluate by completing a file review of existing information, no additional evaluation data is needed.',
          },
        ],
      },
      fileReviewNote:
        'A school district draws from a variety of sources in the evaluation process. A file review may include aptitude and achievement tests, teacher input, physical condition, social and cultural background, and adaptive behavior. The information obtained from all sources must be documented.',
      meetingNote:
        'You will be invited to participate in a meeting to review the evaluation or file review results and to determine if your child is eligible for a plan under Section 504.',
      parentConsent: {
        heading: 'PARENT CONSENT',
        voluntaryStatement: 'I understand that the granting of consent is voluntary.',
        options: [
          { key: 'given',  label: 'Consent to evaluate is given' },
          { key: 'denied', label: 'Consent to evaluate is denied' },
        ],
        signatureFields: [
          { key: 'parentSignature', label: 'Parent/Guardian Signature', type: 'signature' },
          { key: 'signatureDate',   label: 'Date',                      type: 'date' },
          { key: 'phoneNumber',     label: 'Phone Number',              type: 'tel' },
        ],
      },
      contactBlock: {
        label: 'If you have questions, please contact:',
        fields: [
          { key: 'contactName',  label: 'Name',         type: 'text' },
          { key: 'contactTitle', label: 'Title',        type: 'text' },
          { key: 'contactPhone', label: 'Phone number', type: 'tel' },
          { key: 'contactEmail', label: 'Email',        type: 'email' },
        ],
      },
      enclosure:
        'Section 504 Notice of Parent/Student Rights in Identification, Evaluation and Placement.',
    },

    formI: {
      formLetter: 'I',
      title: 'Section 504 Eligibility Determination',
      // Persistence: see Migration 021.
      persistsTo: 'student_504_eligibility_determinations',
      studentInformationFields: STUDENT_INFORMATION_FIELDS,
      teamTable: {
        heading: 'The 504 Team',
        columns: TEAM_TABLE_COLUMNS,
        defaultRowCount: 5,
      },
      sectionA: {
        heading: 'A. Evaluation Summary',
        fields: [
          {
            key: 'educationalHistory',
            label: 'Educational History & Present Educational Placement Status',
            type: 'textarea',
            defaultRowCount: 5,
          },
          {
            key: 'sourcesOfEvaluation',
            label: 'Sources of Evaluation Information (include date and description)',
            type: 'textarea',
            defaultRowCount: 5,
          },
          {
            key: 'resultsOfAssessment',
            label: 'Results of Assessment',
            type: 'textarea',
            defaultRowCount: 5,
          },
          {
            key: 'presentPerformance',
            label: 'Present Learning and Education Performance Description',
            type: 'group',
            fields: [
              {
                key: 'currentClassesAndGrades',
                label: 'Current classes and grades',
                type: 'textarea',
                defaultRowCount: 5,
              },
              {
                key: 'schoolAttendance',
                label: 'School attendance',
                type: 'textarea',
                defaultRowCount: 5,
              },
              {
                key: 'otherRelevantInformation',
                label: 'Other relevant information',
                type: 'textarea',
                defaultRowCount: 5,
              },
            ],
          },
        ],
      },
      sectionB: {
        heading: 'B. Eligibility Determination',
        questions: [
          {
            key: 'q1_impairment',
            label: 'Does the student have a physical or mental impairment?',
            type: 'radioWithExplain',
            options: [
              {
                key: 'yes',
                label: 'Yes',
                followUp: { key: 'yesDescription', label: 'describe', type: 'textarea' },
              },
              {
                key: 'no',
                label: 'No',
                followUp: { key: 'noDescription', label: 'explain', type: 'textarea' },
              },
            ],
          },
          {
            key: 'q2_majorLifeActivities',
            label: 'Does the student’s impairment substantially limit one or more major life activities?',
            instruction:
              'If yes, check appropriate box below. (Note: Do not consider medication, assistive devices or other ameliorating factors.)',
            type: 'multiCheckbox',
            options: MAJOR_LIFE_ACTIVITIES,
            followUpDescription: {
              key: 'substantialLimitDescription',
              label: 'If yes, describe how the activity is substantially limited:',
              type: 'textarea',
              defaultRowCount: 5,
            },
            definitionsBlock:
              'Student has a physical or mental impairment that substantially limits one or more major life activities. “Substantial limitation” means that the student is unable to or is significantly restricted as to the condition, manner or duration under which they can perform the major life activity as compared to an average person. “Average person” means average for the student’s age or grade level across a large population -- like the state or the country. The comparison is not to the student’s potential, to the student’s other siblings, or to other students in the class or school.',
          },
          {
            key: 'q3_eligibility',
            label: 'Is the student eligible under Section 504 of the Rehabilitation Act of 1973?',
            type: 'radioWithExplain',
            options: [
              {
                key: 'eligibleWithPlan',
                label: 'Yes, Student is eligible with a 504 plan',
                action: 'Complete a 504 plan',
              },
              {
                key: 'technicallyEligibleNoPlan',
                label:
                  'Yes, Student is technically eligible without a 504 plan (ex. has a history of an impairment, regarded as having an impairment, etc.)',
                followUp: {
                  key: 'technicallyEligibleExplain',
                  label: 'Explain',
                  type: 'textarea',
                },
              },
              {
                key: 'notEligible',
                label: 'No, Student is not eligible',
                followUp: {
                  key: 'notEligibleExplain',
                  label: 'Explain',
                  type: 'textarea',
                },
              },
            ],
          },
        ],
      },
      meetingParticipants: {
        heading: 'Section 504 Meeting Participants',
        columns: [
          { key: 'name',      label: 'Name',      type: 'text' },
          { key: 'signature', label: 'Signature', type: 'signature' },
          { key: 'agree',     label: 'Agree',     type: 'checkbox' },
          { key: 'disagree',  label: 'Disagree',  type: 'checkbox' },
        ],
        defaultRowCount: 5,
      },
      noticeStatement:
        'This document constitutes the district’s notice to parent(s)/guardian(s) regarding the student’s eligibility or non-eligibility under Section 504.',
    },

    formJ: {
      formLetter: 'J',
      title: 'Section 504 Student Accommodation Plan',
      // Persistence: see Migration 021 (and Migration 022 for accommodations JSONB).
      persistsTo: 'student_504_plans',
      conditionalNotice:
        'Section 504 Plan complete only if eligibility determination is “Yes, eligible with a 504 plan”',
      studentInformationFields: STUDENT_INFORMATION_FIELDS,
      planDates: {
        heading: 'Plan Dates',
        fields: [
          {
            key: 'eligibilityDeterminationDate',
            label: 'Initial 504 Eligibility Determination Date',
            type: 'date',
          },
          { key: 'threeYrReevaluationDueDate', label: '3 Yr Reevaluation Due Date', type: 'date' },
          { key: 'dateOfInitialPlan',          label: 'Date of Initial Plan',        type: 'date' },
          { key: 'annualPlanReviewDueDate',    label: 'Annual Plan Review Due Date', type: 'date' },
          { key: 'currentAnnualReviewDate',    label: 'Current 504 Annual Review Date', type: 'date' },
          { key: 'nextPlanReviewDueDate',      label: 'Next 504 Plan Review Due Date', type: 'date' },
        ],
      },
      // Accommodations below are the UI rendering schema. Persistence shape is a
      // JSONB column on student_504_plans (added in Migration 022), keyed by the
      // domain.key values from the array below. Example persisted shape:
      //   { educational: '...', extracurricular: '...', assessments: '...' }
      accommodations: {
        heading: 'Accommodations',
        instruction:
          'List the accommodations, services or supports necessary to address the student’s disability',
        domains: [
          {
            key: 'educational',
            label: 'In the educational setting:',
            type: 'textarea',
            defaultRowCount: 5,
          },
          {
            key: 'extracurricular',
            label:
              'For school district extracurricular activities, field trips and other school related functions:',
            type: 'textarea',
            defaultRowCount: 5,
          },
          {
            key: 'assessments',
            label:
              'For district, state, or standardized assessments (i.e. documentation for AP, ACT, SAT, and/or PSAT):',
            type: 'textarea',
            defaultRowCount: 5,
          },
        ],
      },
      // Declared in UI rendering schema only. Persistence column not added in
      // Migration 021 or Migration 022; a future migration will add it when the
      // workflow needs to store medical-services details.
      medicalServices: {
        label:
          'Are any accommodations services provided by a medically licensed staff?',
        type: 'radioWithFollowUp',
        options: [
          { key: 'yes', label: 'Yes' },
          { key: 'no',  label: 'No' },
        ],
        followUp: {
          label:
            'If yes, describe services and when date service(s) will begin (link IHP, Plan of Care, or service plans)',
          type: 'textarea',
          defaultRowCount: 5,
        },
      },
      educationalPlacement: {
        heading: 'Educational Placement',
        description: {
          key: 'placementDescription',
          label: 'Describe the educational placement:',
          type: 'textarea',
          defaultRowCount: 5,
        },
        options: {
          type: 'singleSelectWithExplain',
          choices: [
            {
              key: 'generalEdWithAccommodations',
              label: 'General education with accommodations as listed',
            },
            {
              key: 'other',
              label: 'Other (describe):',
              followUp: { key: 'otherDescription', type: 'textarea' },
            },
          ],
        },
      },
      teamTable: {
        heading: 'The 504 Team',
        columns: TEAM_TABLE_COLUMNS,
        defaultRowCount: 5,
      },
      parentConsent: {
        heading: 'Parent Consent',
        helpText: '(Complete for an initial 504 plan)',
        options: [
          {
            key: 'agree',
            label:
              'I agree to the implementation of the 504 plan. I understand that granting of consent is voluntary.',
          },
          {
            key: 'disagree',
            label:
              'I do not agree to the implementation of the 504 plan. I understand that granting of consent is voluntary.',
          },
        ],
        signatureFields: [
          { key: 'parentSignature', label: 'Parent/Guardian Signature', type: 'signature' },
          { key: 'signatureDate',   label: 'Date',                      type: 'date' },
          { key: 'phoneNumber',     label: 'Phone Number',              type: 'tel' },
        ],
      },
    },
  },

  // TODO(audit Q5): pending procedural-safeguards source document.
  proceduralSafeguardsText: null,
};
