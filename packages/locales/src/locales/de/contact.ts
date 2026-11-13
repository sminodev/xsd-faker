import type { ContactData } from '../../types.js';

export const contact = {
  phone: [
    '030 23125###',
    '040 66969###',
    '069 90009###',
    '089 99998###',
    '0221 4710###',
    '+49 30 23125###',
    '+49 40 66969###',
    '+49 69 90009###',
    '+49 89 99998###',
    '+49 221 4710###',
  ],
  mobile: ['0171 39200##', '0176 040690##', '+49 171 39200##', '+49 176 040690##'],
  emailDomain: [
    'example.com',
    'example.org',
    'example.net',
    'beispiel.example',
    'firma.example',
    'verwaltung.example',
    'post.example',
  ],
} satisfies ContactData;
