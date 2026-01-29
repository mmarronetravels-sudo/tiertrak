/**
 * Seed Plan Templates
 * 
 * Run this script to populate plan templates for interventions.
 * Usage: node scripts/seedPlanTemplates.js
 * 
 * Or call the API endpoint:
 * POST /api/intervention-plans/admin/templates/bulk-update
 */

const planTemplates = {
  // =============================================
  // BEHAVIOR CONTRACT
  // =============================================
  "Behavior Contract": {
    "name": "Behavior Contract",
    "version": "1.0",
    "sections": [
      {
        "id": "student_agreement",
        "title": "Student Agreement",
        "fields": [
          {
            "id": "target_behaviors",
            "type": "textarea",
            "label": "Target Behaviors (What I will work on)",
            "placeholder": "List the specific behaviors the student agrees to improve...",
            "required": true,
            "rows": 4
          },
          {
            "id": "specific_goals",
            "type": "textarea",
            "label": "Specific Goals",
            "placeholder": "Measurable goals the student will work toward...",
            "required": true,
            "rows": 3
          },
          {
            "id": "strategies",
            "type": "textarea",
            "label": "Strategies I Will Use",
            "placeholder": "What strategies will the student use to meet their goals?",
            "required": false,
            "rows": 3
          }
        ]
      },
      {
        "id": "rewards_consequences",
        "title": "Rewards & Consequences",
        "fields": [
          {
            "id": "rewards",
            "type": "textarea",
            "label": "Rewards for Meeting Goals",
            "placeholder": "What rewards can the student earn?",
            "required": true,
            "rows": 3
          },
          {
            "id": "consequences",
            "type": "textarea",
            "label": "Consequences for Not Meeting Goals",
            "placeholder": "What happens if goals are not met?",
            "required": true,
            "rows": 3
          },
          {
            "id": "check_in_frequency",
            "type": "select",
            "label": "Check-in Frequency",
            "options": ["Daily", "Twice Weekly", "Weekly", "Bi-Weekly"],
            "required": true
          }
        ]
      },
      {
        "id": "staff_support",
        "title": "Staff Support",
        "fields": [
          {
            "id": "staff_commitment",
            "type": "textarea",
            "label": "Staff Commitment (What staff will do to support)",
            "placeholder": "How will staff support the student in meeting these goals?",
            "required": true,
            "rows": 3
          },
          {
            "id": "monitoring_plan",
            "type": "textarea",
            "label": "How Progress Will Be Monitored",
            "placeholder": "Describe how and when progress will be tracked...",
            "required": false,
            "rows": 2
          }
        ]
      },
      {
        "id": "signatures",
        "title": "Signatures",
        "description": "By signing below, all parties agree to the terms of this contract.",
        "fields": [
          {
            "id": "student_signature",
            "type": "signature",
            "label": "Student Signature",
            "required": true
          },
          {
            "id": "student_date",
            "type": "date",
            "label": "Date",
            "required": true
          },
          {
            "id": "staff_signature",
            "type": "signature",
            "label": "Staff Signature",
            "required": true
          },
          {
            "id": "staff_date",
            "type": "date",
            "label": "Date",
            "required": true
          },
          {
            "id": "parent_signature",
            "type": "signature",
            "label": "Parent/Guardian Signature (Optional)",
            "required": false
          },
          {
            "id": "parent_date",
            "type": "date",
            "label": "Date",
            "required": false
          }
        ]
      },
      {
        "id": "review",
        "title": "Contract Review",
        "fields": [
          {
            "id": "review_date",
            "type": "date",
            "label": "Contract Review Date",
            "required": true
          },
          {
            "id": "contract_duration",
            "type": "select",
            "label": "Contract Duration",
            "options": ["1 Week", "2 Weeks", "4 Weeks", "6 Weeks", "9 Weeks", "Semester"],
            "required": true
          }
        ]
      }
    ]
  },

  // =============================================
  // PARENT COMMUNICATION PLAN
  // =============================================
  "Parent Communication Plan": {
    "name": "Parent Communication Plan",
    "version": "1.0",
    "sections": [
      {
        "id": "contact_info",
        "title": "Parent/Guardian Contact Information",
        "fields": [
          {
            "id": "primary_contact_name",
            "type": "text",
            "label": "Primary Contact Name",
            "required": true
          },
          {
            "id": "relationship",
            "type": "select",
            "label": "Relationship to Student",
            "options": ["Mother", "Father", "Stepparent", "Grandparent", "Guardian", "Foster Parent", "Other"],
            "required": true
          },
          {
            "id": "phone",
            "type": "text",
            "label": "Phone Number",
            "required": true
          },
          {
            "id": "email",
            "type": "text",
            "label": "Email Address",
            "required": false
          },
          {
            "id": "preferred_method",
            "type": "select",
            "label": "Preferred Contact Method",
            "options": ["Phone Call", "Text Message", "Email", "Written Note", "App (ClassDojo, Remind, etc.)"],
            "required": true
          },
          {
            "id": "best_time",
            "type": "text",
            "label": "Best Time to Contact",
            "placeholder": "e.g., After 5pm, Lunch break, etc.",
            "required": false
          }
        ]
      },
      {
        "id": "communication_schedule",
        "title": "Communication Schedule",
        "fields": [
          {
            "id": "frequency",
            "type": "select",
            "label": "Communication Frequency",
            "options": ["Daily", "Every Other Day", "Twice Weekly", "Weekly", "Bi-Weekly", "As Needed"],
            "required": true
          },
          {
            "id": "scheduled_day",
            "type": "checkboxGroup",
            "label": "Scheduled Communication Days",
            "options": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
            "required": false
          },
          {
            "id": "communication_topics",
            "type": "checkboxGroup",
            "label": "Topics to Include in Updates",
            "options": [
              "Academic Progress",
              "Behavior Updates",
              "Social Interactions",
              "Homework Completion",
              "Attendance",
              "Positive Achievements",
              "Areas of Concern"
            ],
            "required": true
          }
        ]
      },
      {
        "id": "content",
        "title": "Communication Content",
        "fields": [
          {
            "id": "positive_focus",
            "type": "textarea",
            "label": "Positive Behaviors to Highlight",
            "placeholder": "What positive behaviors should be communicated to parents?",
            "required": true,
            "rows": 3
          },
          {
            "id": "concerns_to_share",
            "type": "textarea",
            "label": "Concerns to Address",
            "placeholder": "What concerns need to be communicated?",
            "required": false,
            "rows": 3
          },
          {
            "id": "parent_input_requested",
            "type": "textarea",
            "label": "Information Requested from Parent",
            "placeholder": "What do you need parents to share with you?",
            "required": false,
            "rows": 2
          }
        ]
      },
      {
        "id": "signatures",
        "title": "Agreement",
        "fields": [
          {
            "id": "staff_signature",
            "type": "signature",
            "label": "Staff Signature",
            "required": true
          },
          {
            "id": "start_date",
            "type": "date",
            "label": "Plan Start Date",
            "required": true
          }
        ]
      }
    ]
  },

  // =============================================
  // ANXIETY MANAGEMENT PLAN
  // =============================================
  "Anxiety Management Plan": {
    "name": "Anxiety Management Plan",
    "version": "1.0",
    "sections": [
      {
        "id": "anxiety_profile",
        "title": "Anxiety Profile",
        "fields": [
          {
            "id": "anxiety_triggers",
            "type": "textarea",
            "label": "Known Anxiety Triggers",
            "placeholder": "What situations, events, or stimuli trigger anxiety for this student?",
            "required": true,
            "rows": 4
          },
          {
            "id": "physical_symptoms",
            "type": "checkboxGroup",
            "label": "Physical Symptoms When Anxious",
            "options": [
              "Rapid heartbeat",
              "Sweating",
              "Shaking/trembling",
              "Stomach ache/nausea",
              "Headache",
              "Difficulty breathing",
              "Crying",
              "Muscle tension",
              "Fatigue",
              "Other"
            ],
            "required": true
          },
          {
            "id": "behavioral_signs",
            "type": "checkboxGroup",
            "label": "Behavioral Signs of Anxiety",
            "options": [
              "Avoidance of tasks/situations",
              "Withdrawal from peers",
              "Excessive worry/questioning",
              "Difficulty concentrating",
              "Refusal to participate",
              "Seeking constant reassurance",
              "Perfectionism",
              "Restlessness",
              "Irritability",
              "Other"
            ],
            "required": true
          },
          {
            "id": "other_symptoms",
            "type": "textarea",
            "label": "Other Symptoms or Signs",
            "placeholder": "Describe any other symptoms not listed above...",
            "required": false,
            "rows": 2
          }
        ]
      },
      {
        "id": "coping_strategies",
        "title": "Coping Strategies",
        "description": "Strategies the student can use when feeling anxious",
        "fields": [
          {
            "id": "breathing_techniques",
            "type": "textarea",
            "label": "Breathing/Relaxation Techniques",
            "placeholder": "e.g., 4-7-8 breathing, progressive muscle relaxation, visualization...",
            "required": true,
            "rows": 3
          },
          {
            "id": "grounding_strategies",
            "type": "textarea",
            "label": "Grounding Strategies",
            "placeholder": "e.g., 5-4-3-2-1 senses, fidget tools, movement breaks...",
            "required": true,
            "rows": 3
          },
          {
            "id": "cognitive_strategies",
            "type": "textarea",
            "label": "Cognitive Strategies",
            "placeholder": "e.g., positive self-talk, thought challenging, breaking tasks into steps...",
            "required": false,
            "rows": 3
          },
          {
            "id": "student_preferences",
            "type": "textarea",
            "label": "Student's Preferred Coping Strategies",
            "placeholder": "What has the student identified as helpful for them personally?",
            "required": true,
            "rows": 3
          }
        ]
      },
      {
        "id": "accommodations",
        "title": "Classroom Accommodations",
        "fields": [
          {
            "id": "environmental",
            "type": "checkboxGroup",
            "label": "Environmental Accommodations",
            "options": [
              "Preferential seating",
              "Access to calm corner/safe space",
              "Reduced visual/auditory stimulation",
              "Permission to leave class when overwhelmed",
              "Fidget tools available",
              "Headphones for noise reduction",
              "Modified lighting"
            ],
            "required": false
          },
          {
            "id": "academic",
            "type": "checkboxGroup",
            "label": "Academic Accommodations",
            "options": [
              "Extended time on assignments/tests",
              "Chunked assignments",
              "Advance notice of changes",
              "Written instructions in addition to verbal",
              "Option to present privately vs. to class",
              "Flexible deadlines during high-anxiety periods",
              "Alternative to timed activities"
            ],
            "required": false
          },
          {
            "id": "social",
            "type": "checkboxGroup",
            "label": "Social Accommodations",
            "options": [
              "Option to work alone or in small groups",
              "Assigned peer buddy",
              "Advance notice of group work",
              "Check-ins before social situations",
              "Modified lunch/recess arrangements"
            ],
            "required": false
          },
          {
            "id": "other_accommodations",
            "type": "textarea",
            "label": "Other Accommodations",
            "placeholder": "Any additional accommodations specific to this student...",
            "required": false,
            "rows": 2
          }
        ]
      },
      {
        "id": "support_plan",
        "title": "Support Plan",
        "fields": [
          {
            "id": "signal_system",
            "type": "textarea",
            "label": "Signal/Cue System",
            "placeholder": "How will the student communicate they need help? (e.g., card on desk, hand signal, code word)",
            "required": true,
            "rows": 2
          },
          {
            "id": "safe_person",
            "type": "text",
            "label": "Designated Safe Person(s)",
            "placeholder": "Who can the student go to when anxious?",
            "required": true
          },
          {
            "id": "safe_space",
            "type": "text",
            "label": "Designated Safe Space",
            "placeholder": "Where can the student go to calm down?",
            "required": true
          },
          {
            "id": "check_in_schedule",
            "type": "textarea",
            "label": "Check-in Schedule",
            "placeholder": "When/how often will staff check in with the student?",
            "required": true,
            "rows": 2
          },
          {
            "id": "crisis_response",
            "type": "textarea",
            "label": "Crisis Response Plan",
            "placeholder": "What should staff do if the student has a panic attack or severe anxiety episode?",
            "required": true,
            "rows": 3
          }
        ]
      },
      {
        "id": "communication",
        "title": "Communication",
        "fields": [
          {
            "id": "parent_communication",
            "type": "textarea",
            "label": "Parent Communication Plan",
            "placeholder": "How/when will parents be informed of anxiety episodes or progress?",
            "required": true,
            "rows": 2
          },
          {
            "id": "staff_sharing",
            "type": "checkboxGroup",
            "label": "Staff Who Need This Plan",
            "options": [
              "All classroom teachers",
              "Specials teachers (PE, Art, Music)",
              "Cafeteria staff",
              "Office staff",
              "Bus driver",
              "Counselor",
              "Administrator"
            ],
            "required": true
          }
        ]
      },
      {
        "id": "signatures",
        "title": "Signatures",
        "fields": [
          {
            "id": "counselor_signature",
            "type": "signature",
            "label": "Counselor/Plan Author",
            "required": true
          },
          {
            "id": "plan_date",
            "type": "date",
            "label": "Date",
            "required": true
          },
          {
            "id": "review_date",
            "type": "date",
            "label": "Plan Review Date",
            "required": true
          }
        ]
      }
    ]
  },

  // =============================================
  // CRISIS SAFETY PLAN
  // =============================================
  "Crisis Safety Plan": {
    "name": "Crisis Safety Plan",
    "version": "1.0",
    "sections": [
      {
        "id": "warning_signs",
        "title": "Warning Signs",
        "description": "Signs that a crisis may be developing",
        "fields": [
          {
            "id": "early_warning_signs",
            "type": "textarea",
            "label": "Early Warning Signs",
            "placeholder": "What are the first signs that the student is becoming distressed?",
            "required": true,
            "rows": 4
          },
          {
            "id": "escalation_signs",
            "type": "textarea",
            "label": "Escalation Signs",
            "placeholder": "What behaviors indicate the student is escalating toward crisis?",
            "required": true,
            "rows": 4
          },
          {
            "id": "crisis_indicators",
            "type": "textarea",
            "label": "Crisis Indicators",
            "placeholder": "What does it look like when the student is in crisis?",
            "required": true,
            "rows": 4
          }
        ]
      },
      {
        "id": "coping_strategies",
        "title": "Coping Strategies",
        "fields": [
          {
            "id": "internal_strategies",
            "type": "textarea",
            "label": "Things I Can Do to Calm Myself",
            "placeholder": "e.g., deep breathing, counting, positive self-talk, visualization...",
            "required": true,
            "rows": 4
          },
          {
            "id": "distractions",
            "type": "textarea",
            "label": "Healthy Distractions",
            "placeholder": "Activities that help distract from distressing thoughts...",
            "required": true,
            "rows": 3
          },
          {
            "id": "safe_environment",
            "type": "textarea",
            "label": "Making My Environment Safe",
            "placeholder": "What can be done to make the environment safer during a crisis?",
            "required": true,
            "rows": 3
          }
        ]
      },
      {
        "id": "support_people",
        "title": "People I Can Contact",
        "fields": [
          {
            "id": "trusted_adult_1",
            "type": "text",
            "label": "Trusted Adult #1 (Name & Contact)",
            "required": true
          },
          {
            "id": "trusted_adult_2",
            "type": "text",
            "label": "Trusted Adult #2 (Name & Contact)",
            "required": true
          },
          {
            "id": "school_contact",
            "type": "text",
            "label": "School Contact (Name & Location)",
            "required": true
          },
          {
            "id": "crisis_hotline",
            "type": "text",
            "label": "Crisis Hotline Number",
            "placeholder": "e.g., 988 (Suicide & Crisis Lifeline)",
            "required": true
          }
        ]
      },
      {
        "id": "professional_support",
        "title": "Professional Support",
        "fields": [
          {
            "id": "therapist_info",
            "type": "text",
            "label": "Therapist/Counselor Name & Contact",
            "required": false
          },
          {
            "id": "psychiatrist_info",
            "type": "text",
            "label": "Psychiatrist Name & Contact (if applicable)",
            "required": false
          },
          {
            "id": "local_crisis_services",
            "type": "textarea",
            "label": "Local Crisis Services/Emergency Room",
            "placeholder": "Name, address, phone number...",
            "required": true,
            "rows": 2
          }
        ]
      },
      {
        "id": "reasons_to_live",
        "title": "My Reasons for Living",
        "description": "Things that are important to me",
        "fields": [
          {
            "id": "reasons",
            "type": "textarea",
            "label": "People, pets, goals, or things that matter to me",
            "placeholder": "List the things that are most important to the student...",
            "required": true,
            "rows": 5
          }
        ]
      },
      {
        "id": "signatures",
        "title": "Signatures",
        "fields": [
          {
            "id": "student_signature",
            "type": "signature",
            "label": "Student Signature",
            "required": true
          },
          {
            "id": "counselor_signature",
            "type": "signature",
            "label": "Counselor Signature",
            "required": true
          },
          {
            "id": "parent_signature",
            "type": "signature",
            "label": "Parent/Guardian Signature",
            "required": true
          },
          {
            "id": "plan_date",
            "type": "date",
            "label": "Date Created",
            "required": true
          },
          {
            "id": "review_date",
            "type": "date",
            "label": "Review Date",
            "required": true
          }
        ]
      }
    ]
  },

  // =============================================
  // DAILY BEHAVIOR REPORT CARD
  // =============================================
  "Daily Behavior Report Card": {
    "name": "Daily Behavior Report Card Setup",
    "version": "1.0",
    "sections": [
      {
        "id": "target_behaviors",
        "title": "Target Behaviors",
        "description": "Select 2-4 specific, observable behaviors to track",
        "fields": [
          {
            "id": "behavior_1",
            "type": "text",
            "label": "Target Behavior #1",
            "placeholder": "e.g., Stays in seat during instruction",
            "required": true
          },
          {
            "id": "behavior_2",
            "type": "text",
            "label": "Target Behavior #2",
            "placeholder": "e.g., Raises hand before speaking",
            "required": true
          },
          {
            "id": "behavior_3",
            "type": "text",
            "label": "Target Behavior #3",
            "placeholder": "e.g., Completes assigned work",
            "required": false
          },
          {
            "id": "behavior_4",
            "type": "text",
            "label": "Target Behavior #4",
            "placeholder": "Optional additional behavior",
            "required": false
          }
        ]
      },
      {
        "id": "rating_system",
        "title": "Rating System",
        "fields": [
          {
            "id": "rating_scale",
            "type": "select",
            "label": "Rating Scale",
            "options": [
              "0-2 (Poor, Fair, Good)",
              "1-3 (Needs Work, Okay, Great)",
              "1-5 Scale",
              "Yes/No",
              "Percentage of Intervals"
            ],
            "required": true
          },
          {
            "id": "rating_periods",
            "type": "checkboxGroup",
            "label": "Rating Periods",
            "options": [
              "Each Class Period",
              "Morning/Afternoon",
              "Hourly",
              "Before Lunch/After Lunch/End of Day",
              "Custom Intervals"
            ],
            "required": true
          },
          {
            "id": "custom_intervals",
            "type": "textarea",
            "label": "Custom Rating Intervals (if applicable)",
            "placeholder": "Describe your custom rating schedule...",
            "required": false,
            "rows": 2
          }
        ]
      },
      {
        "id": "goals_rewards",
        "title": "Goals & Rewards",
        "fields": [
          {
            "id": "daily_goal",
            "type": "text",
            "label": "Daily Point Goal",
            "placeholder": "e.g., 80% of possible points, or 16/20 points",
            "required": true
          },
          {
            "id": "weekly_goal",
            "type": "text",
            "label": "Weekly Goal (if applicable)",
            "placeholder": "e.g., Meet daily goal 4 out of 5 days",
            "required": false
          },
          {
            "id": "daily_reward",
            "type": "textarea",
            "label": "Daily Rewards (for meeting goal)",
            "placeholder": "What can the student earn each day?",
            "required": true,
            "rows": 2
          },
          {
            "id": "weekly_reward",
            "type": "textarea",
            "label": "Weekly Rewards (for meeting weekly goal)",
            "placeholder": "What can the student earn each week?",
            "required": false,
            "rows": 2
          }
        ]
      },
      {
        "id": "logistics",
        "title": "Implementation Details",
        "fields": [
          {
            "id": "who_rates",
            "type": "checkboxGroup",
            "label": "Who Will Complete the DBRC",
            "options": [
              "Classroom Teacher",
              "All Teachers",
              "Special Area Teachers",
              "Paraprofessional",
              "Student (Self-Rating)"
            ],
            "required": true
          },
          {
            "id": "parent_involvement",
            "type": "select",
            "label": "Parent Involvement",
            "options": [
              "Daily sign-off required",
              "Weekly review",
              "Parent provides home reward",
              "Parent notification only",
              "No parent involvement"
            ],
            "required": true
          },
          {
            "id": "feedback_schedule",
            "type": "textarea",
            "label": "Feedback Schedule",
            "placeholder": "When/how will the student receive feedback on their performance?",
            "required": true,
            "rows": 2
          }
        ]
      },
      {
        "id": "signatures",
        "title": "Signatures",
        "fields": [
          {
            "id": "staff_signature",
            "type": "signature",
            "label": "Staff Signature",
            "required": true
          },
          {
            "id": "start_date",
            "type": "date",
            "label": "Start Date",
            "required": true
          },
          {
            "id": "review_date",
            "type": "date",
            "label": "Review Date",
            "required": true
          }
        ]
      }
    ]
  },

  // =============================================
  // BEHAVIOR INTERVENTION PLAN (BIP)
  // =============================================
  "Behavior Intervention Plan": {
    "name": "Behavior Intervention Plan (BIP)",
    "version": "1.0",
    "sections": [
      {
        "id": "behavior_summary",
        "title": "Target Behavior Summary",
        "description": "From Functional Behavior Assessment (FBA)",
        "fields": [
          {
            "id": "target_behavior",
            "type": "textarea",
            "label": "Target Behavior (Operational Definition)",
            "placeholder": "Describe the behavior in specific, observable, measurable terms. What does it look like? Sound like?",
            "required": true,
            "rows": 4
          },
          {
            "id": "baseline_data",
            "type": "textarea",
            "label": "Baseline Data",
            "placeholder": "Current frequency, duration, or intensity of the behavior (e.g., '5-7 incidents per day, lasting 2-10 minutes each')",
            "required": true,
            "rows": 3
          },
          {
            "id": "behavior_function",
            "type": "checkboxGroup",
            "label": "Hypothesized Function of Behavior",
            "options": [
              "Escape/Avoidance (task, demand, person, setting)",
              "Attention (adult, peer, positive, negative)",
              "Access to Tangibles (items, activities, preferred tasks)",
              "Sensory/Automatic (internal stimulation)",
              "Multiple Functions"
            ],
            "required": true
          },
          {
            "id": "function_details",
            "type": "textarea",
            "label": "Function Details",
            "placeholder": "Explain the hypothesized function in detail. What is the student trying to get or avoid?",
            "required": true,
            "rows": 3
          },
          {
            "id": "antecedents",
            "type": "textarea",
            "label": "Common Antecedents/Triggers",
            "placeholder": "What typically happens right before the behavior? (settings, times, activities, people, demands)",
            "required": true,
            "rows": 3
          },
          {
            "id": "consequences",
            "type": "textarea",
            "label": "Current Consequences",
            "placeholder": "What typically happens right after the behavior? How do adults/peers respond?",
            "required": true,
            "rows": 3
          }
        ]
      },
      {
        "id": "replacement_behavior",
        "title": "Replacement Behavior",
        "description": "The appropriate behavior that serves the same function",
        "fields": [
          {
            "id": "replacement_behavior_description",
            "type": "textarea",
            "label": "Replacement Behavior (Operational Definition)",
            "placeholder": "What appropriate behavior will the student use instead? Must serve the same function as the target behavior.",
            "required": true,
            "rows": 4
          },
          {
            "id": "replacement_rationale",
            "type": "textarea",
            "label": "Why This Replacement Behavior?",
            "placeholder": "Explain how this behavior serves the same function and why the student would be motivated to use it.",
            "required": true,
            "rows": 3
          },
          {
            "id": "current_skill_level",
            "type": "select",
            "label": "Student's Current Skill Level with Replacement Behavior",
            "options": [
              "Does not know how to perform the behavior",
              "Knows how but rarely uses it",
              "Uses inconsistently (sometimes)",
              "Uses in some settings but not others",
              "Knows how but chooses not to use it"
            ],
            "required": true
          }
        ]
      },
      {
        "id": "prevention_strategies",
        "title": "Prevention Strategies",
        "description": "Antecedent modifications to prevent the behavior from occurring",
        "fields": [
          {
            "id": "environmental_modifications",
            "type": "checkboxGroup",
            "label": "Environmental Modifications",
            "options": [
              "Preferential seating",
              "Reduce visual/auditory distractions",
              "Provide quiet workspace",
              "Modify physical arrangement",
              "Adjust lighting/temperature",
              "Create structured areas",
              "Post visual schedules/rules",
              "Provide organizational tools"
            ],
            "required": false
          },
          {
            "id": "curricular_modifications",
            "type": "checkboxGroup",
            "label": "Curricular/Instructional Modifications",
            "options": [
              "Shorten assignments",
              "Chunk tasks into smaller steps",
              "Provide choices in tasks/order",
              "Modify difficulty level",
              "Provide additional processing time",
              "Use high-interest materials",
              "Alternate preferred/non-preferred tasks",
              "Provide frequent breaks",
              "Pre-teach difficult concepts",
              "Use visual supports/graphic organizers"
            ],
            "required": false
          },
          {
            "id": "social_modifications",
            "type": "checkboxGroup",
            "label": "Social/Interpersonal Modifications",
            "options": [
              "Increase positive interactions",
              "Provide 1:1 attention before behavior occurs",
              "Assign peer buddy",
              "Modify group size",
              "Provide advance notice of transitions",
              "Use private signals/cues",
              "Increase check-ins",
              "Build relationship with trusted adult"
            ],
            "required": false
          },
          {
            "id": "other_prevention",
            "type": "textarea",
            "label": "Other Prevention Strategies",
            "placeholder": "Describe any additional prevention strategies specific to this student...",
            "required": false,
            "rows": 3
          }
        ]
      },
      {
        "id": "teaching_strategies",
        "title": "Teaching Strategies",
        "description": "How the replacement behavior will be taught",
        "fields": [
          {
            "id": "direct_instruction",
            "type": "textarea",
            "label": "Direct Instruction Plan",
            "placeholder": "How will you explicitly teach the replacement behavior? Include modeling, practice opportunities, and feedback.",
            "required": true,
            "rows": 4
          },
          {
            "id": "practice_opportunities",
            "type": "textarea",
            "label": "Practice Opportunities",
            "placeholder": "When/where will the student practice the replacement behavior? Include role-play, natural opportunities, etc.",
            "required": true,
            "rows": 3
          },
          {
            "id": "prompting_hierarchy",
            "type": "textarea",
            "label": "Prompting/Cueing Plan",
            "placeholder": "What prompts will be used to remind the student to use the replacement behavior? How will prompts be faded?",
            "required": true,
            "rows": 3
          },
          {
            "id": "social_skills_instruction",
            "type": "textarea",
            "label": "Additional Skills to Teach",
            "placeholder": "What other skills need to be taught? (coping skills, social skills, self-regulation, etc.)",
            "required": false,
            "rows": 3
          }
        ]
      },
      {
        "id": "reinforcement_strategies",
        "title": "Reinforcement Strategies",
        "description": "How the replacement behavior will be reinforced",
        "fields": [
          {
            "id": "reinforcement_for_replacement",
            "type": "textarea",
            "label": "Reinforcement for Replacement Behavior",
            "placeholder": "How will the replacement behavior be reinforced? What will the student receive for using it?",
            "required": true,
            "rows": 3
          },
          {
            "id": "reinforcement_schedule",
            "type": "select",
            "label": "Initial Reinforcement Schedule",
            "options": [
              "Continuous (every time)",
              "Fixed Ratio (every X times)",
              "Variable Ratio",
              "Fixed Interval (every X minutes)",
              "Variable Interval"
            ],
            "required": true
          },
          {
            "id": "reinforcement_fading",
            "type": "textarea",
            "label": "Plan for Fading Reinforcement",
            "placeholder": "How will reinforcement be gradually reduced as the behavior becomes established?",
            "required": true,
            "rows": 2
          },
          {
            "id": "preferred_reinforcers",
            "type": "textarea",
            "label": "Student's Preferred Reinforcers",
            "placeholder": "List specific reinforcers that are motivating for this student (based on preference assessment or observation).",
            "required": true,
            "rows": 3
          },
          {
            "id": "reinforcement_delivery",
            "type": "textarea",
            "label": "How Reinforcement Will Be Delivered",
            "placeholder": "Who will deliver reinforcement? When? Include specific praise statements to use.",
            "required": true,
            "rows": 2
          }
        ]
      },
      {
        "id": "response_strategies",
        "title": "Response Strategies",
        "description": "How staff will respond when the target behavior occurs",
        "fields": [
          {
            "id": "initial_response",
            "type": "textarea",
            "label": "Initial Response to Behavior",
            "placeholder": "What should staff do immediately when the behavior first occurs? (Stay calm, redirect, prompt replacement behavior, etc.)",
            "required": true,
            "rows": 3
          },
          {
            "id": "avoid_reinforcing",
            "type": "textarea",
            "label": "Strategies to Avoid Reinforcing Target Behavior",
            "placeholder": "Based on the function, how will you ensure the behavior does NOT result in the desired outcome?",
            "required": true,
            "rows": 3
          },
          {
            "id": "escalation_response",
            "type": "textarea",
            "label": "Response to Escalation",
            "placeholder": "What should staff do if the behavior escalates? Include de-escalation strategies.",
            "required": true,
            "rows": 3
          },
          {
            "id": "post_incident",
            "type": "textarea",
            "label": "Post-Incident Procedures",
            "placeholder": "What happens after the behavior ends? Include debriefing, reteaching, and return to activity.",
            "required": true,
            "rows": 3
          },
          {
            "id": "responses_to_avoid",
            "type": "textarea",
            "label": "Responses to AVOID",
            "placeholder": "What responses should staff NOT use? (based on function analysis)",
            "required": true,
            "rows": 2
          }
        ]
      },
      {
        "id": "crisis_plan",
        "title": "Crisis/Safety Plan",
        "description": "Only complete if behavior poses safety risk",
        "fields": [
          {
            "id": "crisis_needed",
            "type": "select",
            "label": "Does This Behavior Require a Crisis Plan?",
            "options": ["Yes", "No"],
            "required": true
          },
          {
            "id": "crisis_definition",
            "type": "textarea",
            "label": "Definition of Crisis",
            "placeholder": "What does a crisis look like for this student? When is it no longer manageable with regular strategies?",
            "required": false,
            "rows": 3
          },
          {
            "id": "crisis_response",
            "type": "textarea",
            "label": "Crisis Response Procedures",
            "placeholder": "Step-by-step procedures when a crisis occurs. Include who to call, how to clear the room, etc.",
            "required": false,
            "rows": 4
          },
          {
            "id": "physical_intervention",
            "type": "textarea",
            "label": "Physical Intervention (if applicable)",
            "placeholder": "Is physical intervention approved? Who is trained? What techniques are approved?",
            "required": false,
            "rows": 2
          },
          {
            "id": "post_crisis",
            "type": "textarea",
            "label": "Post-Crisis Procedures",
            "placeholder": "What happens after a crisis? Include documentation, parent contact, debrief, and reintegration.",
            "required": false,
            "rows": 3
          }
        ]
      },
      {
        "id": "data_collection",
        "title": "Data Collection & Monitoring",
        "fields": [
          {
            "id": "data_method",
            "type": "checkboxGroup",
            "label": "Data Collection Method(s)",
            "options": [
              "Frequency count (tally)",
              "Duration recording",
              "Interval recording (partial/whole)",
              "Time sampling (momentary)",
              "ABC data",
              "Daily Behavior Report Card",
              "Rating scale",
              "Permanent products"
            ],
            "required": true
          },
          {
            "id": "data_collection_details",
            "type": "textarea",
            "label": "Data Collection Details",
            "placeholder": "Who will collect data? When? How often? Include specific procedures.",
            "required": true,
            "rows": 3
          },
          {
            "id": "goal_criteria",
            "type": "textarea",
            "label": "Goal/Success Criteria",
            "placeholder": "What is the measurable goal? (e.g., 'Reduce incidents from 5/day to 1/day for 4 consecutive weeks')",
            "required": true,
            "rows": 2
          },
          {
            "id": "review_schedule",
            "type": "select",
            "label": "Data Review Schedule",
            "options": [
              "Daily",
              "Weekly",
              "Bi-weekly",
              "Monthly"
            ],
            "required": true
          },
          {
            "id": "review_team",
            "type": "textarea",
            "label": "Data Review Team",
            "placeholder": "Who will review the data and when? Include decision rules for modifying the plan.",
            "required": true,
            "rows": 2
          }
        ]
      },
      {
        "id": "team_roles",
        "title": "Team Roles & Responsibilities",
        "fields": [
          {
            "id": "classroom_teacher_role",
            "type": "textarea",
            "label": "Classroom Teacher(s) Will:",
            "placeholder": "Specific responsibilities for the classroom teacher...",
            "required": true,
            "rows": 3
          },
          {
            "id": "paraprofessional_role",
            "type": "textarea",
            "label": "Paraprofessional/Aide Will (if applicable):",
            "placeholder": "Specific responsibilities for support staff...",
            "required": false,
            "rows": 2
          },
          {
            "id": "counselor_role",
            "type": "textarea",
            "label": "Counselor/Behavior Specialist Will:",
            "placeholder": "Specific responsibilities for counselor or behavior specialist...",
            "required": true,
            "rows": 2
          },
          {
            "id": "administrator_role",
            "type": "textarea",
            "label": "Administrator Will:",
            "placeholder": "Specific responsibilities for administration...",
            "required": false,
            "rows": 2
          },
          {
            "id": "parent_role",
            "type": "textarea",
            "label": "Parent/Guardian Will:",
            "placeholder": "Specific responsibilities for the family...",
            "required": true,
            "rows": 2
          },
          {
            "id": "student_role",
            "type": "textarea",
            "label": "Student Will:",
            "placeholder": "What is expected of the student?",
            "required": true,
            "rows": 2
          }
        ]
      },
      {
        "id": "communication_plan",
        "title": "Communication Plan",
        "fields": [
          {
            "id": "staff_training",
            "type": "textarea",
            "label": "Staff Training Plan",
            "placeholder": "How will all staff working with this student be trained on the BIP?",
            "required": true,
            "rows": 2
          },
          {
            "id": "parent_communication",
            "type": "textarea",
            "label": "Parent Communication Schedule",
            "placeholder": "How and when will parents be informed of progress and incidents?",
            "required": true,
            "rows": 2
          },
          {
            "id": "staff_sharing",
            "type": "checkboxGroup",
            "label": "Staff Who Need Access to This BIP",
            "options": [
              "All classroom teachers",
              "Specials teachers (PE, Art, Music)",
              "Cafeteria staff",
              "Office staff",
              "Bus driver",
              "Counselor",
              "Administrator",
              "Substitute teacher folder"
            ],
            "required": true
          }
        ]
      },
      {
        "id": "signatures",
        "title": "Signatures",
        "fields": [
          {
            "id": "author_signature",
            "type": "signature",
            "label": "BIP Author (Behavior Specialist/Counselor)",
            "required": true
          },
          {
            "id": "author_date",
            "type": "date",
            "label": "Date",
            "required": true
          },
          {
            "id": "teacher_signature",
            "type": "signature",
            "label": "Classroom Teacher",
            "required": true
          },
          {
            "id": "admin_signature",
            "type": "signature",
            "label": "Administrator",
            "required": false
          },
          {
            "id": "parent_signature",
            "type": "signature",
            "label": "Parent/Guardian",
            "required": true
          },
          {
            "id": "parent_date",
            "type": "date",
            "label": "Date",
            "required": true
          },
          {
            "id": "review_date",
            "type": "date",
            "label": "BIP Review Date",
            "required": true
          },
          {
            "id": "fba_date",
            "type": "date",
            "label": "Date of FBA This BIP Is Based On",
            "required": true
          }
        ]
      }
    ]
  },

  // =============================================
  // TOKEN ECONOMY SYSTEM
  // =============================================
  "Token Economy System": {
    "name": "Token Economy System",
    "version": "1.0",
    "sections": [
      {
        "id": "system_overview",
        "title": "System Overview",
        "fields": [
          {
            "id": "system_name",
            "type": "text",
            "label": "Name of Token System (if any)",
            "placeholder": "e.g., 'Star Bucks', 'Dragon Dollars', 'Points System'",
            "required": false
          },
          {
            "id": "token_type",
            "type": "select",
            "label": "Type of Token",
            "options": [
              "Points (written/digital)",
              "Stickers",
              "Stamps",
              "Play money/dollars",
              "Chips/coins",
              "Punch card",
              "Checkmarks",
              "Digital app points",
              "Other"
            ],
            "required": true
          },
          {
            "id": "token_type_other",
            "type": "text",
            "label": "If Other, Describe Token Type",
            "required": false
          },
          {
            "id": "tracking_method",
            "type": "select",
            "label": "How Tokens Will Be Tracked",
            "options": [
              "Paper chart (individual)",
              "Paper chart (class display)",
              "Digital spreadsheet",
              "App (ClassDojo, etc.)",
              "Physical container/bank",
              "Index card",
              "Wristband/bracelet counter",
              "Other"
            ],
            "required": true
          },
          {
            "id": "individual_or_group",
            "type": "select",
            "label": "System Scope",
            "options": [
              "Individual student only",
              "Individual with class-wide system",
              "Small group",
              "Whole class (but tracking this individual)"
            ],
            "required": true
          }
        ]
      },
      {
        "id": "target_behaviors",
        "title": "Behaviors That Earn Tokens",
        "description": "Be specific about what earns tokens",
        "fields": [
          {
            "id": "behavior_1",
            "type": "text",
            "label": "Earning Behavior #1",
            "placeholder": "e.g., Following directions the first time",
            "required": true
          },
          {
            "id": "tokens_1",
            "type": "number",
            "label": "Tokens Earned",
            "required": true
          },
          {
            "id": "behavior_2",
            "type": "text",
            "label": "Earning Behavior #2",
            "placeholder": "e.g., Completing work on time",
            "required": true
          },
          {
            "id": "tokens_2",
            "type": "number",
            "label": "Tokens Earned",
            "required": true
          },
          {
            "id": "behavior_3",
            "type": "text",
            "label": "Earning Behavior #3",
            "placeholder": "e.g., Using kind words with peers",
            "required": false
          },
          {
            "id": "tokens_3",
            "type": "number",
            "label": "Tokens Earned",
            "required": false
          },
          {
            "id": "behavior_4",
            "type": "text",
            "label": "Earning Behavior #4",
            "placeholder": "e.g., Staying in seat during instruction",
            "required": false
          },
          {
            "id": "tokens_4",
            "type": "number",
            "label": "Tokens Earned",
            "required": false
          },
          {
            "id": "behavior_5",
            "type": "text",
            "label": "Earning Behavior #5",
            "required": false
          },
          {
            "id": "tokens_5",
            "type": "number",
            "label": "Tokens Earned",
            "required": false
          },
          {
            "id": "bonus_opportunities",
            "type": "textarea",
            "label": "Bonus Token Opportunities",
            "placeholder": "Any special circumstances when extra tokens can be earned? (e.g., 'Caught being good', exceptional effort)",
            "required": false,
            "rows": 2
          }
        ]
      },
      {
        "id": "token_removal",
        "title": "Response Cost (Optional)",
        "description": "Can tokens be lost? Not recommended for all students.",
        "fields": [
          {
            "id": "use_response_cost",
            "type": "select",
            "label": "Will Tokens Be Removed for Misbehavior?",
            "options": ["No - tokens cannot be lost", "Yes - response cost will be used"],
            "required": true
          },
          {
            "id": "response_cost_behaviors",
            "type": "textarea",
            "label": "Behaviors That Result in Token Loss (if applicable)",
            "placeholder": "Be specific about what causes token loss and how many tokens are lost.",
            "required": false,
            "rows": 3
          },
          {
            "id": "minimum_balance",
            "type": "text",
            "label": "Minimum Token Balance (Cannot Go Below)",
            "placeholder": "e.g., '0' or 'Cannot lose more than earned that day'",
            "required": false
          },
          {
            "id": "response_cost_notes",
            "type": "textarea",
            "label": "Notes About Response Cost",
            "placeholder": "Any cautions, limits, or guidelines for when/how tokens should be removed.",
            "required": false,
            "rows": 2
          }
        ]
      },
      {
        "id": "reward_menu",
        "title": "Reward Menu",
        "description": "What can tokens be exchanged for?",
        "fields": [
          {
            "id": "reward_menu_type",
            "type": "select",
            "label": "Reward Menu Type",
            "options": [
              "Fixed menu (same options always)",
              "Rotating menu (changes periodically)",
              "Student choice (student selects rewards)",
              "Surprise/mystery rewards"
            ],
            "required": true
          },
          {
            "id": "small_rewards",
            "type": "textarea",
            "label": "Small Rewards (Low Token Cost)",
            "placeholder": "List rewards and their cost. e.g., 'Sticker - 5 tokens, Extra bathroom break - 10 tokens'",
            "required": true,
            "rows": 4
          },
          {
            "id": "medium_rewards",
            "type": "textarea",
            "label": "Medium Rewards (Moderate Token Cost)",
            "placeholder": "e.g., 'Homework pass - 25 tokens, Computer time - 30 tokens, Special seat for a day - 35 tokens'",
            "required": true,
            "rows": 4
          },
          {
            "id": "large_rewards",
            "type": "textarea",
            "label": "Large Rewards (High Token Cost)",
            "placeholder": "e.g., 'Lunch with teacher - 50 tokens, Treasure box - 75 tokens, Pajama day - 100 tokens'",
            "required": true,
            "rows": 4
          },
          {
            "id": "home_rewards",
            "type": "textarea",
            "label": "Home Rewards (if parent participating)",
            "placeholder": "Are there rewards parents provide at home? List them and costs.",
            "required": false,
            "rows": 3
          },
          {
            "id": "reward_preferences",
            "type": "textarea",
            "label": "This Student's Preferred Rewards",
            "placeholder": "Based on preference assessment, what rewards is this student most motivated by?",
            "required": true,
            "rows": 3
          }
        ]
      },
      {
        "id": "exchange_schedule",
        "title": "Exchange Schedule",
        "fields": [
          {
            "id": "exchange_frequency",
            "type": "select",
            "label": "How Often Can Tokens Be Exchanged?",
            "options": [
              "Immediately (as earned)",
              "End of each activity/period",
              "End of morning/afternoon",
              "End of each day",
              "Weekly",
              "When student reaches goal",
              "Student choice (save or spend)"
            ],
            "required": true
          },
          {
            "id": "exchange_procedure",
            "type": "textarea",
            "label": "Exchange Procedure",
            "placeholder": "Describe how the exchange process works. Where? When? Who manages it?",
            "required": true,
            "rows": 3
          },
          {
            "id": "saving_options",
            "type": "textarea",
            "label": "Saving Options",
            "placeholder": "Can the student save tokens? For how long? Any interest/bonus for saving?",
            "required": false,
            "rows": 2
          },
          {
            "id": "banking_system",
            "type": "select",
            "label": "Token Banking",
            "options": [
              "No banking - tokens reset daily/weekly",
              "Partial banking - some carry over",
              "Full banking - all tokens carry over",
              "Savings account - separate tracked balance"
            ],
            "required": true
          }
        ]
      },
      {
        "id": "delivery_guidelines",
        "title": "Token Delivery Guidelines",
        "fields": [
          {
            "id": "who_delivers",
            "type": "checkboxGroup",
            "label": "Who Can Award Tokens?",
            "options": [
              "Classroom teacher only",
              "All teachers",
              "Paraprofessionals/aides",
              "Specials teachers",
              "Office staff",
              "Cafeteria/recess staff",
              "Student (self-monitoring)"
            ],
            "required": true
          },
          {
            "id": "delivery_timing",
            "type": "select",
            "label": "Token Delivery Timing",
            "options": [
              "Immediately after behavior",
              "At natural breaks",
              "At scheduled intervals",
              "End of activity"
            ],
            "required": true
          },
          {
            "id": "verbal_praise",
            "type": "textarea",
            "label": "Verbal Praise to Accompany Tokens",
            "placeholder": "What should staff say when giving tokens? Include specific behavior-linked praise. e.g., 'You earned a token for raising your hand!'",
            "required": true,
            "rows": 3
          },
          {
            "id": "discretion_guidelines",
            "type": "textarea",
            "label": "Discretion/Privacy Guidelines",
            "placeholder": "Should tokens be given privately or publicly? Any concerns about peer reactions?",
            "required": false,
            "rows": 2
          },
          {
            "id": "frequency_goal",
            "type": "text",
            "label": "Target Earning Frequency",
            "placeholder": "Approximately how many tokens should student earn per day to stay motivated?",
            "required": true
          }
        ]
      },
      {
        "id": "fading_plan",
        "title": "Fading Plan",
        "description": "How will the system be reduced over time?",
        "fields": [
          {
            "id": "fading_criteria",
            "type": "textarea",
            "label": "Criteria for Beginning to Fade",
            "placeholder": "What needs to happen before fading begins? (e.g., '4 consecutive weeks meeting daily goal')",
            "required": true,
            "rows": 2
          },
          {
            "id": "fading_steps",
            "type": "textarea",
            "label": "Fading Steps",
            "placeholder": "Describe the gradual steps to fade the system. (e.g., reduce token frequency, increase goal, add delay, move to natural reinforcement)",
            "required": true,
            "rows": 4
          },
          {
            "id": "maintenance_plan",
            "type": "textarea",
            "label": "Maintenance Plan",
            "placeholder": "What will happen after the token system is fully faded? How will behavior be maintained?",
            "required": true,
            "rows": 3
          }
        ]
      },
      {
        "id": "troubleshooting",
        "title": "Troubleshooting & Rules",
        "fields": [
          {
            "id": "system_rules",
            "type": "textarea",
            "label": "System Rules",
            "placeholder": "List the rules of the token system. (e.g., 'No begging for tokens', 'Teacher decisions are final', 'Tokens cannot be given to others')",
            "required": true,
            "rows": 4
          },
          {
            "id": "if_not_working",
            "type": "textarea",
            "label": "If the System Isn't Working",
            "placeholder": "What should staff do if the student isn't responding to the system? Who to contact?",
            "required": true,
            "rows": 3
          },
          {
            "id": "student_refuses",
            "type": "textarea",
            "label": "If Student Refuses to Participate",
            "placeholder": "What if the student says they don't care about tokens? Backup plan?",
            "required": false,
            "rows": 2
          },
          {
            "id": "cheating_concerns",
            "type": "textarea",
            "label": "Preventing Gaming/Cheating",
            "placeholder": "Any safeguards to prevent student from gaming the system or counterfeiting tokens?",
            "required": false,
            "rows": 2
          }
        ]
      },
      {
        "id": "parent_involvement",
        "title": "Parent/Home Involvement",
        "fields": [
          {
            "id": "parent_role",
            "type": "select",
            "label": "Level of Parent Involvement",
            "options": [
              "None - school only",
              "Informed only",
              "Daily communication",
              "Home rewards component",
              "Full school-home partnership"
            ],
            "required": true
          },
          {
            "id": "home_communication",
            "type": "textarea",
            "label": "Home Communication Plan",
            "placeholder": "How will parents be informed of daily/weekly progress?",
            "required": false,
            "rows": 2
          },
          {
            "id": "home_procedures",
            "type": "textarea",
            "label": "Home Procedures (if applicable)",
            "placeholder": "If there's a home component, describe how it works.",
            "required": false,
            "rows": 3
          }
        ]
      },
      {
        "id": "signatures",
        "title": "Signatures & Agreement",
        "fields": [
          {
            "id": "student_agreement",
            "type": "checkbox",
            "label": "Student understands and agrees to participate in this token system",
            "required": true
          },
          {
            "id": "student_signature",
            "type": "signature",
            "label": "Student Signature",
            "required": true
          },
          {
            "id": "staff_signature",
            "type": "signature",
            "label": "Staff Member Creating Plan",
            "required": true
          },
          {
            "id": "start_date",
            "type": "date",
            "label": "System Start Date",
            "required": true
          },
          {
            "id": "review_date",
            "type": "date",
            "label": "First Review Date",
            "required": true
          },
          {
            "id": "parent_signature",
            "type": "signature",
            "label": "Parent/Guardian Signature (if involved)",
            "required": false
          }
        ]
      }
    ]
  }
};

// Export for use as a module
module.exports = planTemplates;

// If running directly, output SQL commands
if (require.main === module) {
  console.log('-- SQL to seed plan templates into intervention_templates table');
  console.log('-- Run this after the migration has added the plan_template and has_plan_template columns\n');
  
  Object.entries(planTemplates).forEach(([name, template]) => {
    const escaped = JSON.stringify(template).replace(/'/g, "''");
    console.log(`UPDATE intervention_templates SET plan_template = '${escaped}', has_plan_template = true WHERE name = '${name}';`);
    console.log('');
  });
}
