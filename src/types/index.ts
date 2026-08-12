export type UserRole = "admin" | "closer" | "dev";

export type ProspectStatus =
  | "prospect"
  | "en_appel"
  | "a_rappeler"
  | "rdv"
  | "lien_envoye"
  | "paye"
  | "pas_interesse";

export const PROSPECT_STATUSES = [
  { value: "prospect", label: "Prospect", color: "gray" },
  { value: "en_appel", label: "En appel", color: "amber" },
  { value: "a_rappeler", label: "À rappeler", color: "orange" },
  { value: "rdv", label: "RDV Démo", color: "blue" },
  { value: "lien_envoye", label: "Lien envoyé", color: "violet" },
  { value: "paye", label: "Payé", color: "green" },
  { value: "pas_interesse", label: "Pas intéressé", color: "red" },
] as const;

/**
 * Pipeline dev : suivi de la construction du site, indépendant du statut de
 * vente ci-dessus — un dev ne touche jamais à `status`.
 */
export type DeliveryStage = "a_faire" | "en_cours" | "termine";

export const DELIVERY_STAGES = [
  { value: "a_faire", label: "Site à faire" },
  { value: "en_cours", label: "En cours" },
  { value: "termine", label: "Terminé" },
] as const;

export interface IUser {
  readonly _id: string;
  readonly name: string;
  readonly email: string;
  readonly role: UserRole;
  readonly avatar?: string;
  readonly isActive: boolean;
  /** Tarif de création du site pratiqué par ce compte, en euros HT. */
  readonly quoteAmount?: number;
  /** Abonnement mensuel pratiqué par ce compte, en euros HT. */
  readonly subscriptionAmount?: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface IAddress {
  readonly full: string;
  readonly line1: string;
  readonly line2: string;
  readonly city: string;
  readonly postalCode: string;
  readonly state: string;
  readonly region: string;
  readonly department: string;
  readonly country: string;
  readonly countryCode: string;
}

export interface IEmails {
  readonly individual: string;
  readonly individualFirstName: string;
  readonly individualLastName: string;
  readonly contact: string;
  readonly sales: string;
  readonly marketing: string;
  readonly finance: string;
  readonly admin: string;
  readonly all: string;
}

export interface IProspect {
  readonly _id: string;
  readonly name: string;
  readonly phone: string;
  readonly phoneInternational: string;
  readonly phoneType: string;
  readonly email: string;
  readonly website: string;
  readonly websiteRoot: string;
  readonly address: IAddress;
  readonly location: {
    readonly type: "Point";
    readonly coordinates: readonly [number, number];
  };
  readonly reviews: { readonly rating: number; readonly count: string };
  readonly isClosed: boolean;
  readonly openingHours: Readonly<Record<string, string>>;
  readonly socialLinks: { readonly facebook: string; readonly linkedin: string; readonly twitter: string };
  readonly contactPages: ReadonlyArray<string>;
  readonly emails: IEmails;
  readonly adPixels: string;
  readonly status: ProspectStatus;
  readonly assignedTo:
    | { readonly _id: string; readonly name: string; readonly email?: string; readonly role?: UserRole }
    | string
    | null;
  readonly lockedBy: { readonly _id: string; readonly name: string } | string | null;
  readonly lockedAt: Date | null;
  /**
   * Tarifs effectifs, résolus depuis le détenteur de la fiche par
   * `GET /api/prospects/[id]`. Absent des réponses de liste, qui n'affichent
   * aucun montant.
   */
  readonly pricing?: { readonly quoteAmount: number; readonly subscriptionAmount: number };
  readonly devUrl: string | null;
  readonly rdvDate: Date | null;
  readonly paidAt: Date | null;
  readonly paidAmount: number | null;
  readonly gcPaymentId: string | null;
  readonly qontoInvoiceId: string | null;
  readonly qontoInvoiceNumber: string | null;
  readonly qontoInvoiceUrl: string | null;
  readonly gcBillingRequestId: string | null;
  readonly paymentLink: string | null;
  readonly paymentLinkCreatedAt: Date | null;
  readonly gcMandateBillingRequestId: string | null;
  readonly mandateLink: string | null;
  readonly mandateLinkCreatedAt: Date | null;
  readonly gcMandateId: string | null;
  readonly mandateSignedAt: Date | null;
  readonly gcSubscriptionId: string | null;
  readonly subscriptionStartDate: Date | null;
  readonly signedDate: Date | null;
  readonly deliveredDate: Date | null;
  readonly deliveryStage: DeliveryStage | null;
  readonly googleMapsLink: string;
  readonly tags: ReadonlyArray<string>;
  readonly importBatch: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
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
  readonly _id: string;
  readonly prospectId: string;
  readonly userId: string;
  readonly type: ActivityType;
  readonly content: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

export interface IReminder {
  readonly _id: string;
  readonly prospectId: string;
  readonly userId: string;
  readonly dueDate: Date;
  readonly title: string;
  readonly description: string;
  readonly isCompleted: boolean;
  readonly createdAt: Date;
}
