// Mapping from Google Maps scraping Excel headers to Prospect fields
const COLUMN_MAPPING: Record<string, string> = {
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
};

export function detectMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const header of headers) {
    const trimmed = header.trim();
    if (COLUMN_MAPPING[trimmed]) {
      mapping[trimmed] = COLUMN_MAPPING[trimmed];
    }
  }
  return mapping;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (!current[part] || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]!] = value;
}

export function parseRow(
  row: Record<string, unknown>,
  mapping: Record<string, string>
): Record<string, unknown> {
  const prospect: Record<string, unknown> = {
    address: {},
    socialLinks: {},
    emails: {},
    reviews: {},
    contactPages: [],
    status: "prospect",
  };

  const contactPages: string[] = [];

  for (const [header, field] of Object.entries(mapping)) {
    const value = row[header];
    if (value === undefined || value === null || value === "") continue;

    const strValue = String(value).trim();

    // Special handling
    if (field === "longitude" || field === "latitude") {
      const num = parseFloat(strValue);
      if (!isNaN(num)) {
        if (!prospect.location) {
          prospect.location = { type: "Point", coordinates: [0, 0] };
        }
        const loc = prospect.location as { type: string; coordinates: number[] };
        if (field === "longitude") loc.coordinates[0] = num;
        if (field === "latitude") loc.coordinates[1] = num;
      }
      continue;
    }

    if (field === "isClosed") {
      prospect.isClosed = strValue.toLowerCase() === "oui";
      continue;
    }

    if (field === "openingHours") {
      try {
        prospect.openingHours = JSON.parse(strValue);
      } catch {
        prospect.openingHours = {};
      }
      continue;
    }

    if (field === "reviews.rating") {
      const num = parseFloat(strValue);
      setNestedValue(prospect, field, isNaN(num) ? 0 : num);
      continue;
    }

    if (field.startsWith("contactPage")) {
      if (strValue) contactPages.push(strValue);
      continue;
    }

    if (field === "contactPagesAll") {
      continue; // We build from individual contact pages
    }

    setNestedValue(prospect, field, strValue);
  }

  if (contactPages.length > 0) {
    prospect.contactPages = contactPages;
  }

  return prospect;
}

export function parseRows(
  rows: Record<string, unknown>[],
  mapping: Record<string, string>
): Record<string, unknown>[] {
  return rows.map((row) => parseRow(row, mapping)).filter((p) => p.name);
}
