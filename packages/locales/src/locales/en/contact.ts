import type { ContactData } from '../../types.js';

export const contact = {
  phone: [
    '+1-212-555-01##',
    '+1-310-555-01##',
    '+1-312-555-01##',
    '+1-415-555-01##',
    '(212) 555-01##',
    '(312) 555-01##',
  ],
  mobile: [
    '+1-212-555-01##',
    '+1-310-555-01##',
    '+1-312-555-01##',
    '+1-415-555-01##',
    '(212) 555-01##',
    '(415) 555-01##',
  ],
  emailDomain: ['example.com', 'example.org', 'example.net', 'mail.example', 'corp.example', 'test.example'],
} satisfies ContactData;
