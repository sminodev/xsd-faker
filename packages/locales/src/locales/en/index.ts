import { defineLocale } from '../../locale.js';
import { address } from './address.js';
import { contact } from './contact.js';
import { person } from './person.js';
import { text } from './text.js';

export const en = defineLocale('en', { person, address, contact, text });
