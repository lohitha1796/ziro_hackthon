/* =====================================================================
   dataset.js - synthetic mock data for the Security Questionnaire Filler
   ---------------------------------------------------------------------
   Everything in this file is invented for the hackathon demo. It contains
   no personal data, no customer data and no credentials.

   The dataset is deliberately adversarial:
     * POL-ENC-2023  - a SUPERSEDED encryption standard (AES-128, TLS 1.0/1.1)
     * SRC-MKT-FAQ   - a marketing page claiming "PCI DSS ready"
     * SRC-PRIOR-QNR - a 2023 questionnaire answer claiming "PCI DSS in progress"
     * real gaps      - removable media, background screening, AI training data
   Those documents are retrieved and scored by the agent, then rejected with a
   machine-readable reason. They must never back an answer.
   ===================================================================== */
window.SQF = window.SQF || {};
window.SQF.Dataset = (function () {
  'use strict';

  const APP_VERSION = '1.0.0';

  const PORTAL = {
    baseUrl: 'https://mock-portal.ziro.local',
    name: 'Meridian Vendor Trust Portal (mock)',
    customer: 'Meridian Health Systems (mock customer)',
    questionnaireUrl: 'https://mock-portal.ziro.local/vendor/questionnaire/QNR-2026-0417'
  };

  const ORG = {
    sourceId: 'SRC-VENDOR-PROFILE',
    kind: 'profile',
    title: 'Responder company profile',
    version: '2026-01',
    docType: 'profile',
    status: 'active',
    authority: 'authoritative',
    owner: 'Compliance Operations',
    effectiveFrom: '2026-01-05',
    approvedBy: 'Compliance Operations',
    url: 'https://mock-portal.ziro.local/api/profile',
    categories: ['governance'],
    sections: [
      {
        sectionId: '0.1',
        heading: 'Company profile',
        text:
          'Northstar Cloud Services Ltd is a 220-person SaaS vendor providing a managed analytics platform ' +
          'to healthcare and financial-services customers. Primary region is eu-west-2 with a US secondary ' +
          'region. Security contact is security@northstar.example (mock). The CISO reports to the CEO and ' +
          'chairs a quarterly security steering committee.',
        facts: [
          { factId: 'F-ORG-001', statement: 'Northstar Cloud Services Ltd operates a managed analytics platform from primary region eu-west-2 with a US secondary region.', value: 'eu-west-2', tags: ['governance', 'regions', 'residency'], scope: ['organisation'] },
          { factId: 'F-ORG-002', statement: 'A Chief Information Security Officer (CISO) is appointed, reports to the CEO and chairs a quarterly security steering committee.', value: 'CISO appointed', tags: ['governance', 'ciso', 'oversight'], scope: ['organisation'] }
        ]
      }
    ]
  };

  /* ------------------------------ policies ------------------------------ */
  const POLICIES = [
    {
      sourceId: 'POL-ENC-001',
      kind: 'policy',
      title: 'Data Encryption Standard',
      version: '3.1',
      docType: 'standard',
      status: 'active',
      authority: 'authoritative',
      owner: 'Head of Security Engineering',
      effectiveFrom: '2025-03-14',
      approvedOn: '2025-03-14',
      approvedBy: 'Security Steering Committee',
      supersedes: 'POL-ENC-2023',
      supersededBy: null,
      url: 'https://mock-portal.ziro.local/api/sources/POL-ENC-001',
      categories: ['encryption'],
      sections: [
        {
          sectionId: '1',
          heading: 'Purpose and scope',
          text:
            'This standard applies to all production and backup systems that store, process or transmit ' +
            'Northstar Confidential Data or Customer Data. Non-production environments that contain only ' +
            'synthetic data are explicitly out of scope of sections 3 and 6 of this standard.',
          facts: [
            { factId: 'F-ENC-SCOPE', statement: 'The standard applies to production and backup systems; non-production environments containing only synthetic data are out of scope of sections 3 and 6.', value: 'scope: production, backup', tags: ['scope', 'environments'], scope: ['production', 'backup'] }
          ]
        },
        {
          sectionId: '3.1',
          heading: 'Encryption in transit',
          text:
            'All external traffic and all service-to-service traffic uses TLS 1.2 or higher. TLS 1.3 is the ' +
            'preferred version for new integrations. TLS 1.0 and TLS 1.1 are prohibited on every Northstar ' +
            'endpoint and legacy clients are not supported.',
          facts: [
            { factId: 'F-ENC-TLS', statement: 'All external and service-to-service traffic uses TLS 1.2 or higher; TLS 1.3 is preferred and TLS 1.0 and TLS 1.1 are prohibited.', value: 'TLS 1.2+', tags: ['transit', 'tls', 'encryption-in-transit', 'protocol'], scope: ['production', 'backup'] }
          ]
        },
        {
          sectionId: '3.2',
          heading: 'Encryption at rest',
          text:
            'Customer Data and Confidential Data at rest is encrypted using AES-256 with FIPS 140-2 validated ' +
            'cryptographic modules. Full-disk encryption is enforced on all managed endpoints. Backups inherit ' +
            'the same AES-256 standard and are written to encrypted object storage with versioning enabled.',
          facts: [
            { factId: 'F-ENC-AES256', statement: 'Data at rest, including backups, is encrypted using AES-256 with FIPS 140-2 validated cryptographic modules.', value: 'AES-256', tags: ['at-rest', 'encryption-at-rest', 'algorithm', 'aes', 'backups'], scope: ['production', 'backup'] }
          ]
        },
        {
          sectionId: '3.3',
          heading: 'Key management',
          text:
            'Encryption keys are generated and held in an HSM-backed key management service. Customer-managed ' +
            'keys (BYOK) are available for enterprise tenants. Data encryption keys are rotated at least every ' +
            '12 months and root keys every 36 months. Key access requires dual authorisation and is reviewed ' +
            'quarterly.',
          facts: [
            { factId: 'F-ENC-KMS', statement: 'Encryption keys are held in an HSM-backed key management service, BYOK is available, data encryption keys rotate at least every 12 months and key access requires dual authorisation.', value: 'HSM-backed KMS', tags: ['key-management', 'kms', 'hsm', 'rotation', 'byok'], scope: ['production', 'backup'] }
          ]
        },
        {
          sectionId: '3.4',
          heading: 'Approved cryptographic algorithms',
          text:
            'Approved algorithms are AES-256 for symmetric encryption, RSA-3072 or ECDSA P-256 for asymmetric ' +
            'encryption and SHA-256 or stronger for hashing. Deprecated algorithms - AES-128, SHA-1, RSA-2048, ' +
            'TLS 1.0 and TLS 1.1 - are prohibited in all environments.',
          facts: [
            { factId: 'F-ENC-ALGO', statement: 'Approved cryptography is AES-256, RSA-3072 or ECDSA P-256 and SHA-256 or stronger; AES-128, SHA-1, RSA-2048 and TLS 1.0/1.1 are prohibited.', value: 'AES-256 / SHA-256+', tags: ['algorithm', 'aes', 'approved-algorithms', 'prohibited'], scope: ['production', 'backup'] }
          ]
        }
      ]
    },
    {
      sourceId: 'POL-ENC-2023',
      kind: 'policy',
      title: 'Data Encryption Standard (2023)',
      version: '2.0',
      docType: 'standard',
      status: 'superseded',
      authority: 'authoritative',
      owner: 'Head of Security Engineering',
      effectiveFrom: '2023-01-20',
      approvedOn: '2023-01-20',
      supersededOn: '2025-03-14',
      approvedBy: 'Security Steering Committee',
      supersedes: null,
      supersededBy: 'POL-ENC-001',
      url: 'https://mock-portal.ziro.local/api/sources/POL-ENC-2023',
      categories: ['encryption'],
      sections: [
        {
          sectionId: '3.1',
          heading: 'Encryption in transit',
          text:
            'TLS 1.0, TLS 1.1 or TLS 1.2 may be used depending on client capability. TLS 1.1 is the current ' +
            'default for internal services and TLS 1.0 remains available for legacy integrations.',
          facts: [
            { factId: 'F-2023-TLS', statement: 'TLS 1.0, TLS 1.1 or TLS 1.2 may be used and TLS 1.0 remains available for legacy integrations.', value: 'TLS 1.0-1.2', tags: ['transit', 'tls', 'encryption-in-transit', 'protocol'], scope: ['production'] }
          ]
        },
        {
          sectionId: '3.2',
          heading: 'Encryption at rest',
          text:
            'Data at rest is encrypted using AES-128 or AES-256 at the discretion of the service owner. Key ' +
            'material is stored in the platform configuration store and rotated annually.',
          facts: [
            { factId: 'F-2023-AES', statement: 'Data at rest is encrypted using AES-128 or AES-256 at the discretion of the service owner.', value: 'AES-128 or AES-256', tags: ['at-rest', 'encryption-at-rest', 'algorithm', 'aes'], scope: ['production'] }
          ]
        }
      ]
    },
    {
      sourceId: 'POL-ACC-001',
      kind: 'policy',
      title: 'Access Control and Authentication Standard',
      version: '2.2',
      docType: 'standard',
      status: 'active',
      authority: 'authoritative',
      owner: 'Head of Identity and Access Management',
      effectiveFrom: '2025-07-01',
      approvedOn: '2025-07-01',
      approvedBy: 'Security Steering Committee',
      supersededBy: null,
      url: 'https://mock-portal.ziro.local/api/sources/POL-ACC-001',
      categories: ['access'],
      sections: [
        {
          sectionId: '2.1',
          heading: 'Authentication and multi-factor authentication',
          text:
            'Multi-factor authentication is required for every workforce account and every administrative or ' +
            'privileged account without exception. Phishing-resistant MFA (FIDO2 / WebAuthn security keys) is ' +
            'required for privileged access and for all break-glass accounts. Passwords must be at least 14 ' +
            'characters and are checked against a breached-credential list.',
          facts: [
            { factId: 'F-ACC-MFA', statement: 'Multi-factor authentication is enforced for all workforce accounts and privileged access, with phishing-resistant FIDO2/WebAuthn MFA required for privileged and break-glass accounts.', value: 'MFA enforced', tags: ['mfa', 'authentication', 'admin-access', 'privileged-access'], scope: ['production'] }
          ]
        },
        {
          sectionId: '2.2',
          heading: 'Authorisation and least privilege',
          text:
            'Access is granted through role-based access control on a least-privilege basis. Privileged roles are ' +
            'elevated just-in-time with a maximum session of four hours and are automatically revoked at the end ' +
            'of the session.',
          facts: [
            { factId: 'F-ACC-RBAC', statement: 'Access uses role-based access control with least privilege; privileged roles are elevated just-in-time with a maximum four-hour session.', value: 'RBAC + JIT', tags: ['rbac', 'authorisation', 'least-privilege', 'privileged-access'], scope: ['production'] }
          ]
        },
        {
          sectionId: '2.3',
          heading: 'Access reviews and deprovisioning',
          text:
            'User access rights are reviewed quarterly by system owners. Privileged access is reviewed monthly. ' +
            'Leavers are deprovisioned within four hours of the termination being recorded in the human resources ' +
            'system.',
          facts: [
            { factId: 'F-ACC-REVIEW', statement: 'User access rights are reviewed quarterly, privileged access monthly, and leavers are deprovisioned within four hours.', value: 'quarterly', tags: ['access-review', 'deprovisioning', 'review-frequency'], scope: ['production'] }
          ]
        }
      ]
    },
    {
      sourceId: 'POL-IR-001',
      kind: 'policy',
      title: 'Security Incident Response Plan',
      version: '1.4',
      docType: 'plan',
      status: 'active',
      authority: 'authoritative',
      owner: 'Head of Security Operations',
      effectiveFrom: '2025-09-30',
      approvedOn: '2025-09-30',
      approvedBy: 'Security Steering Committee',
      supersededBy: null,
      url: 'https://mock-portal.ziro.local/api/sources/POL-IR-001',
      categories: ['incident'],
      sections: [
        {
          sectionId: '4.1',
          heading: 'Customer breach notification',
          text:
            'A confirmed personal data breach affecting customer data is notified to affected customers within ' +
            '72 hours of confirmation, and to the relevant supervisory authority within 72 hours where the law ' +
            'requires it. Notification content is reviewed by Legal before release.',
          facts: [
            { factId: 'F-IR-72', statement: 'Confirmed personal data breaches affecting customer data are notified to affected customers within 72 hours of confirmation, and to the supervisory authority within 72 hours where required by law.', value: '72 hours', tags: ['breach-notification', 'notification-window', 'incident-response'], scope: ['production'] }
          ]
        },
        {
          sectionId: '4.2',
          heading: 'Detection, escalation and testing',
          text:
            'The security operations centre is staffed 24x7 and SEV1 incidents are acknowledged within 15 ' +
            'minutes. A tabletop exercise is run annually and a post-incident review is completed within 10 ' +
            'business days of closure.',
          facts: [
            { factId: 'F-IR-SOC', statement: 'A 24x7 security operations centre acknowledges SEV1 incidents within 15 minutes, runs an annual tabletop exercise and completes a post-incident review within 10 business days.', value: '24x7', tags: ['incident-response', 'monitoring', 'tabletop', 'oncall'], scope: ['production'] }
          ]
        }
      ]
    },
    {
      sourceId: 'POL-BCP-001',
      kind: 'policy',
      title: 'Business Continuity and Disaster Recovery Standard',
      version: '1.1',
      docType: 'standard',
      status: 'active',
      authority: 'authoritative',
      owner: 'Head of Platform Reliability',
      effectiveFrom: '2025-05-12',
      approvedOn: '2025-05-12',
      approvedBy: 'Security Steering Committee',
      supersededBy: null,
      url: 'https://mock-portal.ziro.local/api/sources/POL-BCP-001',
      categories: ['continuity'],
      sections: [
        {
          sectionId: '5.1',
          heading: 'Recovery objectives',
          text:
            'Tier-1 services have a recovery time objective of four hours and a recovery point objective of one ' +
            'hour. Services run across multiple availability zones and backups are replicated to a secondary ' +
            'region with a 15 minute replication interval.',
          facts: [
            { factId: 'F-BCP-RTO', statement: 'Tier-1 services have a recovery time objective of four hours and a recovery point objective of one hour.', value: 'RTO 4h / RPO 1h', tags: ['rto', 'rpo', 'recovery', 'continuity'], scope: ['production'] }
          ]
        },
        {
          sectionId: '5.2',
          heading: 'Testing',
          text:
            'A full disaster recovery test is performed annually and the results are reported to the Risk ' +
            'Committee. Backup restoration is spot-checked monthly and restore evidence is retained for three ' +
            'years.',
          facts: [
            { factId: 'F-BCP-TEST', statement: 'A full disaster recovery test is performed annually with results reported to the Risk Committee, and backup restoration is spot-checked monthly.', value: 'annual DR test', tags: ['continuity', 'dr-test', 'backups'], scope: ['production', 'backup'] }
          ]
        }
      ]
    },
    {
      sourceId: 'POL-VUL-001',
      kind: 'policy',
      title: 'Vulnerability and Patch Management Procedure',
      version: '1.2',
      docType: 'procedure',
      status: 'active',
      authority: 'authoritative',
      owner: 'Head of Product Security',
      effectiveFrom: '2025-11-03',
      approvedOn: '2025-11-03',
      approvedBy: 'Security Steering Committee',
      supersededBy: null,
      url: 'https://mock-portal.ziro.local/api/sources/POL-VUL-001',
      categories: ['vulnerability'],
      sections: [
        {
          sectionId: '6.1',
          heading: 'Vulnerability scanning and testing',
          text:
            'Authenticated vulnerability scans run weekly across production infrastructure and dependency ' +
            'scanning runs on every continuous-integration build. An external penetration test is performed ' +
            'quarterly and an application penetration test annually.',
          facts: [
            { factId: 'F-VUL-SCAN', statement: 'Authenticated vulnerability scans run weekly, dependency scanning runs on every CI build, external penetration testing is quarterly and application penetration testing is annual.', value: 'weekly scans', tags: ['scanning', 'pentest', 'vulnerability-management'], scope: ['production'] }
          ]
        },
        {
          sectionId: '6.2',
          heading: 'Remediation service levels',
          text:
            'Critical vulnerabilities are remediated within seven days, high within 30 days, medium within 90 ' +
            'days and low in the next maintenance cycle. Any exception requires a time-bound risk acceptance ' +
            'approved by the CISO.',
          facts: [
            { factId: 'F-VUL-SLA', statement: 'Critical vulnerabilities are remediated within seven days, high within 30 days, medium within 90 days, and exceptions require CISO-approved risk acceptance.', value: 'critical 7 days', tags: ['sla', 'remediation', 'patching', 'vulnerability-management'], scope: ['production'] }
          ]
        }
      ]
    },
    {
      sourceId: 'POL-GOV-001',
      kind: 'policy',
      title: 'Security Governance and Awareness Policy',
      version: '1.0',
      docType: 'policy',
      status: 'active',
      authority: 'authoritative',
      owner: 'Chief Information Security Officer',
      effectiveFrom: '2024-10-01',
      approvedOn: '2024-10-01',
      approvedBy: 'Board Audit and Risk Committee',
      supersededBy: null,
      url: 'https://mock-portal.ziro.local/api/sources/POL-GOV-001',
      categories: ['governance'],
      sections: [
        {
          sectionId: '1.1',
          heading: 'Governance framework',
          text:
            'Northstar maintains an information security management system aligned to ISO/IEC 27001:2022. The ' +
            'CISO chairs a security steering committee that meets quarterly and reports to the Board Audit and ' +
            'Risk Committee twice a year. Internal audit reviews the ISMS annually.',
          facts: [
            { factId: 'F-GOV-ISMS', statement: 'An information security management system aligned to ISO/IEC 27001:2022 is maintained, with quarterly security steering committee meetings and annual internal audit.', value: 'ISO/IEC 27001:2022 ISMS', tags: ['governance', 'isms', 'iso-27001', 'audit'], scope: ['organisation'] }
          ]
        },
        {
          sectionId: '7.1',
          heading: 'Security awareness and training',
          text:
            'All personnel complete security awareness training at onboarding and annually thereafter, plus ' +
            'quarterly phishing simulation exercises. Engineers complete secure-coding training every 12 months.',
          facts: [
            { factId: 'F-GOV-TRAIN', statement: 'All personnel complete security awareness training at onboarding and annually, plus quarterly phishing simulations.', value: 'annual training', tags: ['training', 'awareness', 'phishing'], scope: ['organisation'] }
          ]
        },
        {
          sectionId: '7.2',
          heading: 'Secure development',
          text:
            'New services require threat modelling before build, static and dynamic analysis run in the ' +
            'pipeline, and a second engineer reviews every change to production code. Secrets are managed in a ' +
            'central vault and are not stored in source control.',
          facts: [
            { factId: 'F-GOV-SDLC', statement: 'New services require threat modelling, static and dynamic analysis run in the pipeline, and every production change is peer reviewed with secrets held in a central vault.', value: 'threat modelling + SAST/DAST', tags: ['sdlc', 'threat-modelling', 'code-review', 'secrets'], scope: ['production'] }
          ]
        }
      ]
    },

    /* ---------------- decoy 1: marketing page (non-authoritative) ---------------- */
    {
      sourceId: 'SRC-MKT-FAQ',
      kind: 'marketing',
      title: 'Security FAQ (public marketing site)',
      version: 'v7',
      docType: 'marketing',
      status: 'active',
      authority: 'informational',
      owner: 'Marketing',
      effectiveFrom: '2026-02-02',
      supersededBy: null,
      url: 'https://mock-portal.ziro.local/api/sources/SRC-MKT-FAQ',
      categories: ['certification', 'encryption'],
      sections: [
        {
          sectionId: 'faq-1',
          heading: 'Certifications and compliance',
          text:
            'Northstar is PCI DSS ready and expects to complete PCI DSS certification in 2026. We also hold ' +
            'ISO 27001 and SOC 2 and are "military-grade" 256-bit encrypted end to end. Salesforce and ' +
            'Workday are supported integrations.',
          facts: [
            { factId: 'F-MKT-PCI', statement: 'Northstar is PCI DSS ready and expects to complete PCI DSS certification in 2026.', value: 'PCI DSS ready', tags: ['certification', 'pci-dss', 'compliance'], scope: ['organisation'] }
          ]
        }
      ]
    },

    /* ---------------- decoy 2: 2023 questionnaire response (superseded, non-authoritative) ---------------- */
    {
      sourceId: 'SRC-PRIOR-QNR-2023',
      kind: 'prior-questionnaire',
      title: 'Prior vendor questionnaire response 2023 (Meridian onboarding)',
      version: '2023-05-02',
      docType: 'prior-response',
      status: 'superseded',
      authority: 'informational',
      owner: 'Sales Engineering',
      effectiveFrom: '2023-05-02',
      supersededOn: '2026-01-01',
      supersededBy: 'QNR-2026-0417',
      url: 'https://mock-portal.ziro.local/api/sources/SRC-PRIOR-QNR-2023',
      categories: ['certification', 'encryption'],
      sections: [
        {
          sectionId: 'resp-01',
          heading: 'Response to question 1 - encryption at rest',
          text:
            'Yes. Customer data at rest is encrypted with AES-128 or AES-256 depending on the service. Key ' +
            'management is handled by the platform configuration store.',
          facts: [
            { factId: 'F-PRIOR-AES', statement: 'Customer data at rest is encrypted with AES-128 or AES-256 depending on the service.', value: 'AES-128', tags: ['at-rest', 'encryption-at-rest', 'algorithm', 'aes'], scope: ['production'] }
          ]
        },
        {
          sectionId: 'resp-11',
          heading: 'Response to question 11 - certifications',
          text:
            'PCI DSS: compliant (certification in progress). SOC 2 Type I completed. ISO 27001 certification ' +
            'planned for 2024.',
          facts: [
            { factId: 'F-PRIOR-PCI', statement: 'PCI DSS: compliant, certification in progress.', value: 'PCI DSS compliant', tags: ['certification', 'pci-dss', 'compliance'], scope: ['organisation'] }
          ]
        }
      ]
    }
  ];

  /* --------------------- certification registry (authoritative) --------------------- */
  const CERT_REGISTRY = {
    sourceId: 'SRC-CERT-REG-2026',
    kind: 'registry',
    title: 'Certification and attestation registry',
    version: '2026-01-05',
    docType: 'registry',
    status: 'active',
    authority: 'authoritative',
    owner: 'Compliance Operations',
    effectiveFrom: '2026-01-05',
    approvedBy: 'Chief Information Security Officer',
    supersededBy: null,
    url: 'https://mock-portal.ziro.local/api/registry/certifications',
    categories: ['certification', 'governance'],
    sections: [
      {
        sectionId: 'cert-held',
        heading: 'Held certifications and attestations (current)',
        text:
          'SOC 2 Type II report covering Security, Availability and Confidentiality, valid from 1 December ' +
          '2025 to 30 November 2026, issued by Mock Audit LLP. ISO/IEC 27001:2022 certificate valid from 1 ' +
          'June 2024 to 31 May 2027, issued by a UKAS-accredited certification body.',
        facts: [
          { factId: 'F-CERT-SOC2', statement: 'A SOC 2 Type II report covering Security, Availability and Confidentiality is held, valid from 1 December 2025 to 30 November 2026.', value: 'SOC 2 Type II - valid to 2026-11-30', tags: ['certification', 'soc2', 'attestation'], scope: ['organisation'] },
          { factId: 'F-CERT-ISO', statement: 'An ISO/IEC 27001:2022 certificate is held, valid from 1 June 2024 to 31 May 2027.', value: 'ISO/IEC 27001:2022 - valid to 2027-05-31', tags: ['certification', 'iso-27001'], scope: ['organisation'] }
        ]
      },
      {
        sectionId: 'cert-not-held',
        heading: 'Certifications not held',
        text:
          'PCI DSS is not held: no PCI DSS assessment has been completed and Northstar does not store or ' +
          'process cardholder data directly, because card payments are handled by a PCI DSS Level 1 payment ' +
          'processor. FedRAMP authorisation is not held. ISO/IEC 27701 is not held. CSA STAR is not held. ' +
          'HIPAA is not applicable to Northstar as a business associate for the Meridian deployment.',
        facts: [
          { factId: 'F-CERT-NOTPCI', statement: 'PCI DSS certification is not held; no PCI DSS assessment has been completed and card payments are handled by a PCI DSS Level 1 payment processor.', value: 'PCI DSS: not held', tags: ['certification', 'pci-dss', 'not-held'], scope: ['organisation'] },
          { factId: 'F-CERT-NOTFED', statement: 'FedRAMP authorisation is not held and ISO/IEC 27701 is not held; CSA STAR is not held.', value: 'FedRAMP/ISO 27701/CSA STAR: not held', tags: ['certification', 'fedramp', 'iso-27701', 'csa-star', 'not-held'], scope: ['organisation'] }
        ]
      }
    ]
  };

  const SOURCES = POLICIES.concat([ORG, CERT_REGISTRY]);

  /* ------------------------------ questionnaires ------------------------------ */
  const QUESTIONNAIRE = {
    questionnaireId: 'QNR-2026-0417',
    portalName: PORTAL.name,
    title: 'Meridian Health Systems - Vendor Security Review 2026',
    revision: 'v4.0',
    issuedOn: '2026-09-28',
    dueOn: '2026-10-30',
    status: 'open',
    sourceUrl: PORTAL.questionnaireUrl,
    sections: [
      {
        sectionId: 'A',
        title: 'Data protection and encryption',
        questions: [
          {
            questionId: 'Q-01',
            text: 'Is all customer data encrypted at rest? If yes, state the algorithm used and how the encryption keys are managed.',
            answerType: 'yesno_detail', category: 'encryption', aspectTags: ['at-rest', 'algorithm', 'key-management'],
            materiality: 'high', required: true,
            expectation: 'Polarity: yes.'
          },
          {
            questionId: 'Q-02',
            text: 'Is data encrypted in transit between customers and your platform? State the minimum TLS version you support.',
            answerType: 'yesno_detail', category: 'encryption', aspectTags: ['transit', 'tls', 'protocol'],
            materiality: 'high', required: true,
            expectation: 'Polarity: yes.'
          },
          {
            questionId: 'Q-03',
            text: 'Are backups protected to the same encryption standard as production data?',
            answerType: 'yesno_detail', category: 'encryption', aspectTags: ['backups', 'encryption-at-rest'],
            materiality: 'medium', required: true,
            expectation: 'Polarity: yes.'
          },
          {
            questionId: 'Q-04',
            text: 'Is data stored on removable media such as USB drives or external disks encrypted, and is such media permitted?',
            answerType: 'yesno_detail', category: 'physical', aspectTags: ['removable-media', 'media-encryption', 'endpoint'],
            materiality: 'medium', required: true,
            expectation: 'Gap: no approved source addresses removable media.'
          },
          {
            questionId: 'Q-05',
            text: 'Are all employees and contractors subject to background screening before they are granted access to customer data?',
            answerType: 'yesno_detail', category: 'hr', aspectTags: ['background-check', 'screening', 'personnel'],
            materiality: 'medium', required: true,
            expectation: 'Gap: no approved source addresses background screening.'
          },
          {
            questionId: 'Q-06',
            text: 'Is multi-factor authentication enforced for all administrative access to production systems?',
            answerType: 'yesno_detail', category: 'access', aspectTags: ['mfa', 'admin-access', 'authentication'],
            materiality: 'high', required: true,
            expectation: 'Polarity: yes.'
          },
          {
            questionId: 'Q-07',
            text: 'How frequently are user access rights reviewed, and how quickly are leavers deprovisioned?',
            answerType: 'detail', category: 'access', aspectTags: ['access-review', 'review-frequency', 'deprovisioning'],
            materiality: 'medium', required: true,
            expectation: 'Frequency must be stated exactly as the policy states it.'
          },
          {
            questionId: 'Q-08',
            text: 'Will you notify customers of a confirmed data breach affecting our data, and within what timeframe?',
            answerType: 'yesno_detail', category: 'incident', aspectTags: ['breach-notification', 'notification-window', 'incident-response'],
            materiality: 'high', required: true,
            expectation: 'Window must match the policy (72 hours).'
          },
          {
            questionId: 'Q-09',
            text: 'What are your recovery time objective (RTO) and recovery point objective (RPO) for the service we would use?',
            answerType: 'detail', category: 'continuity', aspectTags: ['rto', 'rpo', 'recovery'],
            materiality: 'medium', required: true,
            expectation: 'Objectives must match the policy.'
          },
          {
            questionId: 'Q-10',
            text: 'What is your remediation service level for critical vulnerabilities, and how often do you scan?',
            answerType: 'detail', category: 'vulnerability', aspectTags: ['sla', 'remediation', 'patching', 'scanning'],
            materiality: 'medium', required: true,
            expectation: 'Service level must match the procedure.'
          },
          {
            questionId: 'Q-11',
            text: 'Are you PCI DSS certified? If yes, provide the assessment date and the name of the qualified security assessor.',
            answerType: 'yesno_detail', category: 'certification', aspectTags: ['certification', 'pci-dss', 'compliance'],
            materiality: 'high', required: true,
            expectation: 'The company does not hold PCI DSS. Never claim it. Marketing and 2023 documents say otherwise - record the conflict.'
          },
          {
            questionId: 'Q-12',
            text: 'Which independent certifications or attestations do you currently hold, and what are their validity dates?',
            answerType: 'detail', category: 'certification', aspectTags: ['certification', 'soc2', 'iso-27001'],
            materiality: 'high', required: true,
            expectation: 'Only registry-held certifications with dates may be named.'
          },
          {
            questionId: 'Q-13',
            text: 'Is customer data used to train your AI or machine-learning models, and where is that stated in your policies?',
            answerType: 'yesno_detail', category: 'ai', aspectTags: ['ai-training', 'model-training', 'data-use'],
            materiality: 'high', required: true,
            expectation: 'Gap: no approved source addresses AI or model training.'
          },
          {
            questionId: 'Q-14',
            text: 'Do you support TLS 1.0 or TLS 1.1 for legacy clients that cannot be upgraded?',
            answerType: 'yesno_detail', category: 'encryption', aspectTags: ['tls', 'protocol', 'legacy', 'transit'],
            materiality: 'medium', required: true,
            expectation: 'Current standard prohibits TLS 1.0/1.1. The 2023 standard allowed them - that document must be rejected.'
          },
          {
            questionId: 'Q-15',
            text: 'Is data at rest encrypted with AES-256 across all environments, including non-production environments?',
            answerType: 'yesno_detail', category: 'encryption', aspectTags: ['at-rest', 'algorithm', 'environments', 'scope'],
            materiality: 'medium', required: true,
            expectation: 'Scope mismatch: the standard covers production and backup only and excludes non-production. Escalate instead of asserting.'
          }
        ]
      }
    ]
  };

  /* --------------------------- prior 2023 submission --------------------------- */
  const PRIOR_QUESTIONNAIRE = {
    questionnaireId: 'QNR-2023-0912',
    title: 'Meridian onboarding security questionnaire 2023',
    revision: 'v1.1',
    issuedOn: '2023-04-10',
    dueOn: '2023-05-02',
    status: 'submitted',
    submittedOn: '2023-05-02',
    submittedBy: 'Sales Engineering',
    sourceUrl: 'https://mock-portal.ziro.local/vendor/questionnaire/QNR-2023-0912',
    responses: [
      { questionId: 'Q-01', text: 'Is customer data encrypted at rest?', answer: 'Yes - AES-128 or AES-256 depending on the service.', submittedAt: '2023-05-02T11:20:00Z' },
      { questionId: 'Q-11', text: 'Are you PCI DSS certified?', answer: 'PCI DSS: compliant, certification in progress.', submittedAt: '2023-05-02T11:24:00Z' }
    ]
  };

  /* ------------------------------ lexicons ------------------------------ */
  const STOPWORDS = ('a an the is are do does did you your we our us it its of to in on for with and or if yes no how what which ' +
    'when where who whom that this these those there be been being has have had will would shall should can could may might ' +
    'must state states stated provide provided specify specified please if any all at as by from not non so such than then ' +
    'them they their us via').split(/\s+/);

  const SYNONYMS = {
    'at-rest': ['at rest', 'rest', 'stored', 'storage', 'disk', 'stored data', 'encryption at rest'],
    'encryption-at-rest': ['at rest', 'stored', 'storage', 'encryption'],
    'transit': ['in transit', 'in-transit', 'network', 'transport', 'communication', 'traffic', 'tls', 'ssl'],
    'tls': ['tls', 'ssl', 'transport layer security', 'https', 'protocol', 'version'],
    'algorithm': ['algorithm', 'cipher', 'cryptography', 'cryptographic', 'aes', 'rsa', 'sha', 'encryption standard'],
    'key-management': ['key management', 'keys', 'kms', 'hsm', 'byok', 'rotation', 'key custody'],
    'backups': ['backup', 'backups', 'snapshot', 'restore', 'replication'],
    'mfa': ['mfa', 'multi-factor', 'multifactor', 'two-factor', '2fa', 'authentication', 'fido2', 'webauthn'],
    'admin-access': ['administrative', 'admin', 'privileged', 'root', 'break-glass', 'elevated'],
    'access-review': ['access review', 'recertification', 'rights review', 'quarterly review', 'periodic review'],
    'review-frequency': ['frequency', 'how often', 'quarterly', 'monthly', 'annually', 'interval'],
    'deprovisioning': ['deprovision', 'deactivation', 'leaver', 'offboarding', 'termination'],
    'breach-notification': ['breach', 'notification', 'notify', 'disclosure', 'incident notification'],
    'notification-window': ['timeframe', 'how long', 'within', 'hours', 'window', 'hours of confirmation'],
    'incident-response': ['incident', 'response', 'escalation', 'soc', 'on-call'],
    'rto': ['rto', 'recovery time', 'recovery time objective'],
    'rpo': ['rpo', 'recovery point', 'recovery point objective'],
    'recovery': ['recovery', 'restore', 'availability', 'resilience'],
    'sla': ['sla', 'service level', 'timeframe', 'remediation time', 'patch window'],
    'remediation': ['remediate', 'remediation', 'patch', 'patching', 'fix', 'remediate critical'],
    'patching': ['patch', 'patching', 'update', 'upgrade'],
    'scanning': ['scan', 'scanning', 'assessment', 'penetration test', 'pentest', 'testing'],
    'certification': ['certification', 'certificate', 'certified', 'attestation', 'report', 'audit report', 'accreditation'],
    'pci-dss': ['pci', 'pci dss', 'pci-dss', 'cardholder', 'payment card', 'qsa'],
    'soc2': ['soc 2', 'soc2', 'soc 2 type ii', 'soc 2 type i', 'ssae'],
    'iso-27001': ['iso 27001', 'iso/iec 27001', 'iso27001', '27001'],
    'removable-media': ['removable media', 'usb', 'usb drive', 'external disk', 'thumb drive', 'portable media', 'flash drive'],
    'media-encryption': ['media encryption', 'usb encryption', 'portable device'],
    'endpoint': ['endpoint', 'laptop', 'workstation', 'device', 'full-disk', 'full disk'],
    'background-check': ['background check', 'background screening', 'screening', 'vetting', 'pre-employment'],
    'screening': ['screening', 'vetting', 'criminal record', 'reference check'],
    'personnel': ['employee', 'employees', 'contractor', 'contractors', 'staff', 'personnel', 'workforce'],
    'ai-training': ['ai', 'artificial intelligence', 'machine learning', 'ml', 'model training', 'training data'],
    'model-training': ['train', 'training', 'model', 'models', 'llm', 'foundation model'],
    'data-use': ['use of data', 'data usage', 'customer data used', 'processing purpose'],
    'scope': ['scope', 'environments', 'environment', 'non-production', 'production', 'staging', 'development'],
    'environments': ['environment', 'environments', 'non-production', 'production', 'dev', 'test', 'staging'],
    'legacy': ['legacy', 'old client', 'cannot be upgraded', 'backward compatibility', 'deprecated'],
    'protocol': ['protocol', 'version', 'version number'],
    'compliance': ['compliance', 'compliant', 'conformance'],
    'not-held': ['not held', 'do not hold', 'no certification', 'not certified'],
    'governance': ['governance', 'oversight', 'committee', 'policy management'],
    'training': ['training', 'awareness', 'education']
  };

  const CATEGORY_ROUTING = {
    encryption: ['POL-ENC-001', 'POL-ENC-2023', 'SRC-PRIOR-QNR-2023'],
    access: ['POL-ACC-001'],
    incident: ['POL-IR-001'],
    continuity: ['POL-BCP-001'],
    vulnerability: ['POL-VUL-001'],
    governance: ['POL-GOV-001', 'SRC-CERT-REG-2026'],
    certification: ['SRC-CERT-REG-2026', 'SRC-MKT-FAQ', 'SRC-PRIOR-QNR-2023'],
    physical: ['POL-ENC-001', 'SRC-VENDOR-PROFILE'],
    hr: ['POL-GOV-001', 'SRC-VENDOR-PROFILE'],
    ai: ['SRC-VENDOR-PROFILE', 'SRC-MKT-FAQ']
  };

  /* Scope vocabulary used by the scope-coverage check. */
  const SCOPE_LEXICON = [
    { scope: 'production', terms: ['production', 'prod', 'live'] },
    { scope: 'backup', terms: ['backup', 'backups', 'snapshot', 'restore', 'archive'] },
    { scope: 'non-production', terms: ['non-production', 'non production', 'development', 'dev', 'staging', 'test environment', 'test environments', 'sandbox', 'lower environments'] },
    { scope: 'endpoint', terms: ['endpoint', 'endpoints', 'laptop', 'laptops', 'workstation', 'workstations', 'mobile device', 'mobile devices'] },
    { scope: 'organisation', terms: ['company', 'organisation', 'organization', 'employees', 'staff', 'personnel', 'vendor'] }
  ];

  /* Universal scope words that do not narrow a question. */
  const SCOPE_UNIVERSAL = ['all', 'every', 'any', 'each', 'entire', 'both', 'including'];

  const CERT_TERMS = [
    { term: 'pci dss', registryKey: 'PCI DSS' },
    { term: 'pci-dss', registryKey: 'PCI DSS' },
    { term: 'soc 2', registryKey: 'SOC 2 Type II' },
    { term: 'soc2', registryKey: 'SOC 2 Type II' },
    { term: 'iso 27001', registryKey: 'ISO/IEC 27001:2022' },
    { term: 'iso/iec 27001', registryKey: 'ISO/IEC 27001:2022' },
    { term: 'iso 27701', registryKey: 'ISO/IEC 27701' },
    { term: 'fedramp', registryKey: 'FedRAMP' },
    { term: 'csa star', registryKey: 'CSA STAR' },
    { term: 'hipaa', registryKey: 'HIPAA' }
  ];

  const CERTS = [
    { certId: 'CERT-SOC2', name: 'SOC 2 Type II', status: 'held', scope: 'Security, Availability, Confidentiality', validFrom: '2025-12-01', validTo: '2026-11-30', issuer: 'Mock Audit LLP', evidenceUrl: 'https://mock-portal.ziro.local/api/registry/certifications/CERT-SOC2' },
    { certId: 'CERT-ISO27001', name: 'ISO/IEC 27001:2022', status: 'held', scope: 'Information security management system', validFrom: '2024-06-01', validTo: '2027-05-31', issuer: 'UKAS-accredited certification body (mock)', evidenceUrl: 'https://mock-portal.ziro.local/api/registry/certifications/CERT-ISO27001' },
    { certId: 'CERT-PCI', name: 'PCI DSS', status: 'not_held', scope: 'Cardholder data environment', validFrom: null, validTo: null, issuer: null, evidenceUrl: 'https://mock-portal.ziro.local/api/registry/certifications/CERT-PCI', note: 'No PCI DSS assessment has been completed. Card payments are handled by a PCI DSS Level 1 payment processor; Northstar does not store or process cardholder data.' },
    { certId: 'CERT-FEDRAMP', name: 'FedRAMP', status: 'not_held', scope: 'US federal cloud authorisation', validFrom: null, validTo: null, issuer: null, evidenceUrl: 'https://mock-portal.ziro.local/api/registry/certifications/CERT-FEDRAMP', note: 'No FedRAMP authorisation. US public-sector deployments are not currently offered.' },
    { certId: 'CERT-ISO27701', name: 'ISO/IEC 27701', status: 'not_held', scope: 'Privacy information management', validFrom: null, validTo: null, issuer: null, evidenceUrl: 'https://mock-portal.ziro.local/api/registry/certifications/CERT-ISO27701', note: 'Not held. Privacy programme is aligned to the standard but no certificate is in place.' },
    { certId: 'CERT-CSASTAR', name: 'CSA STAR', status: 'not_held', scope: 'Cloud controls assessment', validFrom: null, validTo: null, issuer: null, evidenceUrl: 'https://mock-portal.ziro.local/api/registry/certifications/CERT-CSASTAR', note: 'Not held.' },
    { certId: 'CERT-HIPAA', name: 'HIPAA', status: 'not_held', scope: 'US healthcare privacy and security', validFrom: null, validTo: null, issuer: null, evidenceUrl: 'https://mock-portal.ziro.local/api/registry/certifications/CERT-HIPAA', note: 'HIPAA is a regulation, not a certification. Northstar does not act as a business associate for this deployment.' }
  ];

  /* ------------------------------ test cases ------------------------------ */
  const TEST_CASES = [
    {
      tcId: 'TC1',
      scenario: 'Encryption question with policy evidence',
      expected: 'answer saved with citation',
      focusQuestionId: 'Q-01',
      input: {
        questionnaire: 'QNR-2026-0417 (all 15 questions)',
        focus: 'Q-01 - Is all customer data encrypted at rest? State the algorithm and key management.',
        sources: 'POL-ENC-001 v3.1 (active), plus the full source set including superseded and non-authoritative documents'
      },
      expectedDetail: 'Q-01 is answered with AES-256 and HSM-backed KMS, cites POL-ENC-001 v3.1 with a verbatim quote, is written to the portal after approval, and passes verification.'
    },
    {
      tcId: 'TC2',
      scenario: 'No evidence for a control',
      expected: "marked 'unknown' for reviewer",
      focusQuestionId: 'Q-04',
      input: {
        questionnaire: 'QNR-2026-0417 (all 15 questions)',
        focus: 'Q-04 - Is data on removable media such as USB drives encrypted and is such media permitted?',
        sources: 'same full source set - no approved document addresses removable media'
      },
      expectedDetail: 'Q-04 is marked unknown with the search trail (best score below threshold), a reviewer task is raised, and nothing is written to the portal for Q-04.'
    },
    {
      tcId: 'TC3',
      scenario: 'Superseded 2023 policy',
      expected: 'not used',
      focusQuestionId: 'Q-14',
      input: {
        questionnaire: 'QNR-2026-0417 (all 15 questions)',
        focus: 'Q-14 - Do you support TLS 1.0 or TLS 1.1 for legacy clients?',
        sources: 'POL-ENC-2023 v2.0 (superseded, allows TLS 1.0/1.1 and AES-128) is present alongside the active standard'
      },
      expectedDetail: 'Q-14 is answered "No" citing POL-ENC-001 v3.1. POL-ENC-2023 and the 2023 prior questionnaire are rejected with reason status=superseded, and no answer anywhere in the run cites them.'
    },
    {
      tcId: 'TC4',
      scenario: 'Asks about a certification the company lacks',
      expected: 'never claimed',
      focusQuestionId: 'Q-11',
      input: {
        questionnaire: 'QNR-2026-0417 (all 15 questions)',
        focus: 'Q-11 - Are you PCI DSS certified? Provide assessment date and QSA name.',
        sources: 'certification registry (PCI DSS = not held) plus two documents that claim PCI DSS progress: the marketing FAQ and the 2023 questionnaire response'
      },
      expectedDetail: 'Q-11 answers that PCI DSS is not held, cites the certification registry, records the conflicting marketing/2023 claims as rejected, and the claim guard confirms no certification is claimed without registry support.'
    }
  ];

  return {
    APP_VERSION: APP_VERSION,
    PORTAL: PORTAL,
    ORG: ORG,
    POLICIES: POLICIES,
    CERT_REGISTRY: CERT_REGISTRY,
    SOURCES: SOURCES,
    CERTS: CERTS,
    QUESTIONNAIRE: QUESTIONNAIRE,
    PRIOR_QUESTIONNAIRE: PRIOR_QUESTIONNAIRE,
    STOPWORDS: STOPWORDS,
    SYNONYMS: SYNONYMS,
    CATEGORY_ROUTING: CATEGORY_ROUTING,
    SCOPE_LEXICON: SCOPE_LEXICON,
    SCOPE_UNIVERSAL: SCOPE_UNIVERSAL,
    CERT_TERMS: CERT_TERMS,
    TEST_CASES: TEST_CASES
  };
})();
