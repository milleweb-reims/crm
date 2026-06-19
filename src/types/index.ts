export type UserRole = "admin" | "closer" | "dev";

export type ProspectStatus =
  | "prospect"
  | "rdv"
  | "en_dev"
  | "devis_envoye"
  | "signe"
  | "livre";

export const PROSPECT_STATUSES: {
  value: ProspectStatus;
  label: string;
  color: string;
}[] = [
  { value: "prospect", label: "Prospect", color: "gray" },
  { value: "rdv", label: "RDV", color: "blue" },
  { value: "en_dev", label: "En dev", color: "orange" },
  { value: "devis_envoye", label: "Devis envoyé", color: "violet" },
  { value: "signe", label: "Signé", color: "green" },
  { value: "livre", label: "Livré", color: "emerald" },
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
  assignedTo: string | null;
  quoteAmount: number | null;
  devUrl: string | null;
  rdvDate: Date | null;
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
  | "import";

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
