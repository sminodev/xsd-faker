import { checkValue } from './check.js';
import { facetValues, firstOf, type ValueContext, type ValueSource } from './source.js';
export const PROFILE_NAMES = ['generic', 'retail', 'insurance', 'logistics'] as const;
export type ProfileName = (typeof PROFILE_NAMES)[number];
export interface ProfileOptions {
  locale?: 'en' | 'de';
  /** Fixed by default so the same seed does not change tomorrow. */
  referenceDate?: string;
}
export type ValueLists = Readonly<Record<string, string | readonly string[]>>;
/** Exact local-name paths; attribute paths use /@name. Lists are sampled with the run's seeded RNG. */
export function valueLists(lists: ValueLists): ValueSource {
  return {
    value(context) {
      const parts = [...context.path];
      if (context.kind === 'attribute') {
        parts[parts.length - 1] = `@${parts.at(-1) ?? ''}`;
      }
      const path = `/${parts.join('/')}`;
      const configured = Object.hasOwn(lists, path) ? lists[path] : undefined;
      if (configured === undefined) {
        return undefined;
      }
      const values = (typeof configured === 'string' ? [configured] : configured).filter(
        (value) => checkValue(context.facets, value) === undefined,
      );
      return values.length ? context.rng.pick(values) : undefined;
    },
  };
}
/** Small, synthetic domain vocabulary, not a catalogue of real customers or domain-valid identifiers. */
export function profileValues(profile: ProfileName = 'generic', options: ProfileOptions = {}): ValueSource {
  if (!PROFILE_NAMES.includes(profile)) {
    throw new TypeError(`unknown profile: ${profile}`);
  }
  if (options.locale !== undefined && options.locale !== 'en' && options.locale !== 'de') {
    throw new TypeError('locale must be en or de');
  }
  const instant = new Date(options.referenceDate ?? '2026-01-15T12:00:00Z');
  if (!Number.isFinite(instant.getTime())) {
    throw new TypeError('referenceDate must be an ISO date or timestamp');
  }
  const iso = instant.toISOString();
  const de = options.locale === 'de';
  const domain: ValueSource = {
    value(context: ValueContext) {
      const { facets, rng } = context;
      const name = context.name.replace(/[-_ ]/g, '').toLowerCase();
      if (facets.unsupportedBounds) return undefined;
      if (facets.builtin === 'date') {
        return iso.slice(0, 10);
      }
      if (facets.builtin === 'dateTime') {
        return iso.replace('.000Z', 'Z');
      }
      if (facets.builtin === 'time') {
        return iso.slice(11).replace('.000Z', 'Z');
      }
      if (/email/.test(name)) {
        return `sample${rng.int(1, 9999)}@example.invalid`;
      }
      if (['currency', 'currencycode', 'waehrung'].includes(name)) {
        return 'EUR';
      }
      if (['country', 'countrycode', 'land'].includes(name)) {
        return 'DE';
      }
      if (['firstname', 'vorname'].includes(name)) {
        return de ? 'Test' : 'Sample';
      }
      if (['lastname', 'surname', 'nachname'].includes(name)) {
        return de ? 'Person' : 'Customer';
      }
      if (['name', 'customername', 'insuredname', 'patientname', 'recipient', 'recipientname'].includes(name)) {
        return de ? 'Testperson Beispiel' : 'Sample Customer';
      }
      if (['street', 'address', 'strasse'].includes(name)) {
        return de ? 'Beispielweg 1' : '1 Example Street';
      }
      if (['city', 'stadt', 'ort'].includes(name)) {
        return de ? 'Musterstadt' : 'Example City';
      }
      if (['postalcode', 'postcode', 'zip', 'plz'].includes(name)) {
        return '12345';
      }
      if (['company', 'carrier', 'organisation'].includes(name)) {
        return profile === 'logistics' ? 'Example Logistics' : 'Example Company';
      }
      const id = String(rng.int(1, 999999)).padStart(6, '0');
      if (['orderid', 'ordernumber', 'bestellnummer'].includes(name)) {
        return `ORD-${id}`;
      }
      if (['policyid', 'policynumber', 'vertragsnummer'].includes(name)) {
        return `POL-${id}`;
      }
      if (['claimid', 'claimnumber', 'schadennummer'].includes(name)) {
        return `CLM-${id}`;
      }
      if (['shipmentid', 'shipmentnumber', 'trackingnumber', 'sendungsnummer'].includes(name)) {
        return `SHP-${id}`;
      }
      if (['customerid', 'customerref', 'kundennummer'].includes(name)) {
        return `CUS-${id}`;
      }
      if (['item', 'product', 'productname', 'artikel'].includes(name) && profile === 'retail') {
        return rng.pick(de ? ['Papier', 'Stifte', 'Ordner'] : ['Paper', 'Pens', 'Folders']);
      }
      if (name === 'description' || name === 'title') {
        return profile === 'insurance'
          ? de
            ? 'Synthetischer Schadenfall'
            : 'Synthetic claim'
          : profile === 'logistics'
            ? de
              ? 'Testsendung'
              : 'Test shipment'
            : de
              ? 'Testbestellung'
              : 'Test order';
      }
      return undefined;
    },
  };
  return firstOf(domain, facetValues);
}
