/**
 * Maps Google Maps scraping Excel headers to prospect field paths.
 * Enables flexible column detection and field assignment during data import.
 */
const COLUMN_MAPPING = {
  "Nom": "name",
  "Lien": "googleMapsLink",
  "Téléphone": "phone",
  "Téléphone international": "phoneInternational",
  "Type de téléphone": "phoneType",
  "Email": "email",
  "Site internet": "website",
  "Site internet (url racine)": "websiteRoot",
  "Adresse complète": "address.full",
  "District": "address.district",
  "Adresse 1": "address.line1",
  "Adresse 2": "address.line2",
  "Ville": "address.city",
  "Code postal": "address.postalCode",
  "État": "address.state",
  "Division de niveau 1": "address.region",
  "Division de niveau 2": "address.department",
  "Pays": "address.country",
  "Code pays": "address.countryCode",
  "Longitude": "longitude",
  "Latitude": "latitude",
  "Note des avis": "reviews.rating",
  "Nombre d'avis": "reviews.count",
  "Est fermé définitivement": "isClosed",
  "Heures d'ouverture": "openingHours",
  "Lien Facebook": "socialLinks.facebook",
  "Lien Linkedin": "socialLinks.linkedin",
  "Lien Twitter": "socialLinks.twitter",
  "Page de contact 1": "contactPage1",
  "Page de contact 2": "contactPage2",
  "Page de contact 3": "contactPage3",
  "Page de contact 4": "contactPage4",
  "Page de contact 5": "contactPage5",
  "Toutes les pages de contact": "contactPagesAll",
  "Email individuel": "emails.individual",
  "Prénom de l'email individuel": "emails.individualFirstName",
  "Nom de l'email individuel": "emails.individualLastName",
  "Email de contact": "emails.contact",
  "Email des ventes": "emails.sales",
  "Email marketing": "emails.marketing",
  "Email financier": "emails.finance",
  "Email administratif": "emails.admin",
  "Tous les emails": "emails.all",
  "Tous les liens Facebook": "socialLinks.allFacebook",
  "Tous les liens Twitter": "socialLinks.allTwitter",
  "Tous les liens Linkedin": "socialLinks.allLinkedin",
  "Pixels publicitaires du site": "adPixels",
} as const;

/**
 * Detects which columns in the provided headers correspond to known prospect fields.
 * @param headers Excel column headers to map
 * @returns Object mapping recognized header names to prospect field paths
 */
export function detectMapping(headers: ReadonlyArray<string>): Record<string, string> {
  return Object.fromEntries(
    headers
      .map((header) => header.trim())
      .filter((trimmed) => trimmed in COLUMN_MAPPING)
      .map((trimmed) => [trimmed, COLUMN_MAPPING[trimmed as keyof typeof COLUMN_MAPPING]] as const)
  );
}

/**
 * Returns a new object with value immutably set at the given dot-notation path.
 * @param options - Configuration object
 * @param options.target - Target object to update
 * @param options.path - Dot-separated field path (e.g. "address.city")
 * @param options.value - Value to assign
 * @returns New object with nested value set
 */
function withNestedValue(options: {
  readonly target: Record<string, unknown>;
  readonly path: string;
  readonly value: unknown;
}): Record<string, unknown> {
  const { target, path, value } = options;
  const parts = path.split(".");

  if (parts.length === 0) return target;
  if (parts.length === 1) return { ...target, [parts[0]!]: value };

  const [head, ...tail] = parts;
  const existing = target[head!];
  const child = existing && typeof existing === "object" ? (existing as Record<string, unknown>) : {};

  return {
    ...target,
    [head!]: withNestedValue({ target: child, path: tail.join("."), value }),
  };
}

/**
 * Returns a new prospect with the geographic coordinate set on its location object.
 */
function parseCoordinatesField(options: {
  readonly prospect: Record<string, unknown>;
  readonly field: string;
  readonly value: string;
}): Record<string, unknown> {
  const num = parseFloat(options.value);
  if (isNaN(num)) return options.prospect;

  const location = (options.prospect.location as
    | { type: string; coordinates: ReadonlyArray<number> }
    | undefined) ?? { type: "Point", coordinates: [0, 0] };

  const coordinates =
    options.field === "longitude"
      ? [num, location.coordinates[1] ?? 0]
      : [location.coordinates[0] ?? 0, num];

  return { ...options.prospect, location: { ...location, coordinates } };
}

/**
 * Values meaning "permanently closed" across the export formats we receive.
 * Excel booleans reach us as "true"/"false" once stringified, hence both forms.
 */
const CLOSED_VALUES: ReadonlySet<string> = new Set([
  "oui",
  "yes",
  "vrai",
  "true",
  "1",
]);

/**
 * Determines whether a raw cell value marks the establishment as permanently closed.
 */
function isClosedValue(value: string): boolean {
  return CLOSED_VALUES.has(value.trim().toLowerCase());
}

/**
 * Returns a new prospect with closed status parsed from the raw cell value.
 */
function parseClosedField(
  prospect: Record<string, unknown>,
  value: string
): Record<string, unknown> {
  return { ...prospect, isClosed: isClosedValue(value) };
}

/**
 * Returns a new prospect with opening hours parsed from JSON string, falling back to empty object on parse error.
 */
function parseOpeningHoursField(
  prospect: Record<string, unknown>,
  value: string
): Record<string, unknown> {
  try {
    return { ...prospect, openingHours: JSON.parse(value) };
  } catch {
    return { ...prospect, openingHours: {} };
  }
}

/**
 * Parses and returns prospect with reviews rating set, defaulting to 0 on parse error.
 */
function parseReviewsRatingField(prospect: Record<string, unknown>, value: string): Record<string, unknown> {
  const num = parseFloat(value);
  return withNestedValue({ target: prospect, path: "reviews.rating", value: isNaN(num) ? 0 : num });
}

/**
 * Determines if a field represents a contact page.
 */
function isContactPageField(field: string): boolean {
  return field.startsWith("contactPage");
}

/**
 * Determines if a field should be skipped during processing.
 */
function shouldSkipField(field: string): boolean {
  return field === "contactPagesAll";
}

/**
 * Processes a single row entry, dispatching to appropriate handler based on field type.
 * @param options - Configuration object
 * @param options.prospect - Prospect object to update
 * @param options.contactPages - Array to collect contact page URLs
 * @param options.field - Field name from column mapping
 * @param options.value - Raw value from Excel cell
 * @returns Updated prospect object
 */
function processRowEntry(options: {
  readonly prospect: Record<string, unknown>;
  readonly contactPages: string[];
  readonly field: string;
  readonly value: unknown;
}): Record<string, unknown> {
  const { prospect, contactPages, field, value } = options;

  if (value === undefined || value === null || value === "") return prospect;

  const strValue = String(value).trim();

  if (field === "longitude" || field === "latitude") {
    return parseCoordinatesField({ prospect, field, value: strValue });
  }

  if (field === "isClosed") {
    return parseClosedField(prospect, strValue);
  }

  if (field === "openingHours") {
    return parseOpeningHoursField(prospect, strValue);
  }

  if (field === "reviews.rating") {
    return parseReviewsRatingField(prospect, strValue);
  }

  if (isContactPageField(field)) {
    if (strValue) contactPages.push(strValue);
    return prospect;
  }

  if (shouldSkipField(field)) {
    return prospect;
  }

  return withNestedValue({ target: prospect, path: field, value: strValue });
}

/**
 * Transforms a single row from Excel data using the detected column mapping.
 * Handles special cases for coordinates, status, opening hours, and contact pages.
 * Builds nested prospect object with initialized containers for addresses, social links, emails, and reviews.
 * @param row Excel row data keyed by header name
 * @param mapping Column header to prospect field path mapping
 * @returns Prospect object with processed fields and nested structures
 */
export function parseRow(
  row: Record<string, unknown>,
  mapping: Record<string, string>
): Record<string, unknown> {
  let prospect: Record<string, unknown> = {
    address: {},
    socialLinks: {},
    emails: {},
    reviews: {},
    contactPages: [],
    status: "prospect",
  };

  const contactPages: string[] = [];

  Object.entries(mapping).forEach(([header, field]) => {
    prospect = processRowEntry({
      prospect,
      contactPages,
      field,
      value: row[header],
    });
  });

  if (contactPages.length > 0) {
    prospect.contactPages = contactPages;
  }

  return prospect;
}

/**
 * Result of parsing an Excel sheet, with the counts of rows deliberately discarded.
 */
export interface ParseRowsResult {
  readonly prospects: Record<string, unknown>[];
  readonly closedCount: number;
  readonly unnamedCount: number;
}

/**
 * Transforms multiple rows from Excel data, discarding rows without a name and
 * establishments flagged as permanently closed ("Est fermé définitivement").
 * @param rows Array of Excel row data
 * @param mapping Column header to prospect field path mapping
 * @returns Importable prospects plus the number of rows skipped per reason
 */
export function parseRows(
  rows: ReadonlyArray<Record<string, unknown>>,
  mapping: Record<string, string>
): ParseRowsResult {
  const parsed = rows.map((row) => parseRow(row, mapping));
  const named = parsed.filter((prospect) => Boolean(prospect.name));
  const prospects = named.filter((prospect) => prospect.isClosed !== true);

  return {
    prospects,
    closedCount: named.length - prospects.length,
    unnamedCount: parsed.length - named.length,
  };
}
