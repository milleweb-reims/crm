export type UserRole = "admin" | "closer" | "dev";

export type ProspectStatus =
  | "prospect"
  | "en_appel"
  | "rdv"
  | "lien_envoye"
  | "paye"
  | "pas_interesse";

export const PROSPECT_STATUSES: {
  value: ProspectStatus;
  label: string;
  color: string;
}[] = [
  { value: "prospect", label: "Prospect", color: "gray" },
  { value: "en_appel", label: "En appel", color: "amber" },
  { value: "rdv", label: "RDV Démo", color: "blue" },
  { value: "lien_envoye", label: "Lien envoyé", color: "violet" },
  { value: "paye", label: "Payé", color: "green" },
  { value: "pas_interesse", label: "Pas intéressé", color: "red" },
];

export interface IUser {
  _id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAddress {
  full: string;
  line1: string;
  line2: string;
  city: string;
  postalCode: string;
  state: string;
  region: string;
  department: string;
  country: string;
  countryCode: string;
}

export interface IEmails {
  individual: string;
  individualFirstName: string;
  individualLastName: string;
  contact: string;
  sales: string;
  marketing: string;
  finance: string;
  admin: string;
  all: string;
}

export interface IProspect {
  _id: string;
  name: string;
  phone: string;
  phoneInternational: string;
  phoneType: string;
  email: string;
  website: string;
  websiteRoot: string;
  address: IAddress;
  location: {
    type: "Point";
    coordinates: [number, number];
  };
  reviews: { rating: number; count: string };
  isClosed: boolean;
  openingHours: Record<string, string>;
  socialLinks: { facebook: string; linkedin: string; twitter: string };
  contactPages: string[];
  emails: IEmails;
  adPixels: string;
  status: ProspectStatus;
  assignedTo:
    | { _id: string; name: string; email?: string; role?: UserRole }
    | string
    | null;
  lockedBy: { _id: string; name: string } | string | null;
  lockedAt: Date | null;
  quoteAmount: number | null;
  devUrl: string | null;
  rdvDate: Date | null;
  paidAt: Date | null;
  paidAmount: number | null;
  gcPaymentId: string | null;
  qontoInvoiceId: string | null;
  qontoInvoiceNumber: string | null;
  qontoInvoiceUrl: string | null;
  gcBillingRequestId: string | null;
  paymentLink: string | null;
  paymentLinkCreatedAt: Date | null;
  signedDate: Date | null;
  deliveredDate: Date | null;
  googleMapsLink: string;
  tags: string[];
  importBatch: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ActivityType =
  | "note"
  | "call"
  | "email"
  | "status_change"
  | "reminder"
  | "import"
  | "payment";

export interface IActivity {
  _id: string;
  prospectId: string;
  userId: string;
  type: ActivityType;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface IReminder {
  _id: string;
  prospectId: string;
  userId: string;
  dueDate: Date;
  title: string;
  description: string;
  isCompleted: boolean;
  createdAt: Date;
}
